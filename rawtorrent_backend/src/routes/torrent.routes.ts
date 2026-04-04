import { Router } from "express";
import fs from "node:fs";
import multer from "multer";

import { listSessionEvents } from "../services/persistenceService";
import { 
  getTorrentSession, 
  getUserSessions, 
  startTorrent,
  getDownloadProgress,
  getPieceStates,
  getPeerDownloadStates,
  getDownloadedFile,
  getDownloadedFileInfo,
  getWebTorrentFile,
  pauseTorrent,
  resumeTorrent,
  stopTorrent,
  getTorrentStatus,
} from "../services/torrentService";


const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/start", upload.single("torrentFile"), async (req, res, next) => {
  console.log("========== NEW TORRENT UPLOAD REQUEST ==========");
  console.log("[Route] User ID:", "local-user");
  console.log("[Route] Uploaded File Name:", req.file?.originalname);
  console.log("[Route] File bytes received:", req.file?.size || req.file?.buffer?.length || 0);

  try {
    const { magnetUri, sessionId } = req.body ?? {};
    const fileBuffer = req.file?.buffer;
    const fileName = req.file?.originalname;

    if (!magnetUri && !fileBuffer) {
      console.warn("[Route] Error: Missing magnetUri or torrentFile");
      res.status(400).json({ success: false, error: "Provide magnetUri or a torrentFile upload" });
      return;
    }

    console.log("[Route] Passing to startTorrent service...");
    const result = await startTorrent({
      input: fileBuffer,
      magnetUri,
      fileName,
      sessionId,
      userId: "local-user",
    });
    console.log("[Route] Successfully started torrent session:", result.session.sessionId);

    res.status(202).json({
      success: true,
      data: {
        sessionId: result.session.sessionId,
        session: result.session,
        parsedTorrent: result.parsedTorrent,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/sessions", async (req, res, next) => {
  try {
    const userId = "local-user";

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const sessions = await getUserSessions(userId);
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

router.get("/sessions/:sessionId", async (req, res, next) => {
  try {
  const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

  res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

router.get("/sessions/:sessionId/events", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const events = await listSessionEvents(sessionId);
    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DOWNLOAD API ROUTES
// ============================================================================

// Get download progress with detailed stats
router.get("/sessions/:sessionId/progress", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const progress = getDownloadProgress(sessionId);
    res.json({ 
      success: true, 
      data: progress ?? {
        totalBytes: 0,
        downloadedBytes: 0,
        progress: session.progress,
        downloadSpeed: 0,
        uploadSpeed: 0,
        activePeers: session.peers.length,
        piecesCompleted: session.completedPieces.length,
        piecesTotal: session.pieceCount,
        eta: -1,
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get piece states for visualization
router.get("/sessions/:sessionId/pieces", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const pieces = getPieceStates(sessionId);
    res.json({ success: true, data: pieces ?? [] });
  } catch (error) {
    next(error);
  }
});

// Get peer download states
router.get("/sessions/:sessionId/peers", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const peers = getPeerDownloadStates(sessionId);
    res.json({ success: true, data: peers ?? session.peers });
  } catch (error) {
    next(error);
  }
});

// Download completed or actively streaming file
router.get("/sessions/:sessionId/download", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const fileName = session.fileName || "download";
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

    const wtf = getWebTorrentFile(sessionId);
    if (wtf) {
      // Stream directly from the active WebTorrent engine piece store!
      const fileSize = wtf.length;
      const range = req.headers.range;
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const stream = wtf.createReadStream({ start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "application/octet-stream",
          "X-File-Name": safeFileName
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName}"`,
          "X-File-Name": safeFileName
        });
        wtf.createReadStream().pipe(res);
      }
      return;
    }

    // Fallback: If not actively in memory Engine, parse disk (for paused/finished)
    const fileInfo = getDownloadedFileInfo(sessionId);

    if (fileInfo && fs.existsSync(fileInfo.path)) {
      const range = req.headers.range;
      const fileSize = fileInfo.size;
      
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const stream = fs.createReadStream(fileInfo.path, { start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "application/octet-stream",
          "X-File-Name": safeFileName
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName}"`,
          "X-File-Name": safeFileName
        });
        fs.createReadStream(fileInfo.path).pipe(res);
      }
      return;
    }

    // Double fallback (for old buffers, deprecated largely but safe checking)
    const fileBuffer = getDownloadedFile(sessionId);
    if (!fileBuffer) {
      res.status(404).json({ success: false, error: "File data not available" });
      return;
    }

    res.setHeader("Content-Length", fileBuffer.length);
    res.setHeader("X-File-Size", fileBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
    res.setHeader("X-File-Name", safeFileName);
    res.send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TORRENT CONTROL ROUTES (PAUSE/RESUME/STOP)
// ============================================================================

// Pause a torrent download
router.post("/sessions/:sessionId/pause", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const success = await pauseTorrent(sessionId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: "Torrent paused",
        data: { status: "paused", progress: session.progress }
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: "Cannot pause torrent",
        currentStatus: session.status
      });
    }
  } catch (error) {
    next(error);
  }
});

// Resume a paused torrent
router.post("/sessions/:sessionId/resume", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const success = await resumeTorrent(sessionId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: "Torrent resumed",
        data: { status: "running", progress: session.progress }
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: "Cannot resume torrent",
        currentStatus: session.status
      });
    }
  } catch (error) {
    next(error);
  }
});

// Stop a torrent completely
router.post("/sessions/:sessionId/stop", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const success = await stopTorrent(sessionId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: "Torrent stopped",
        data: { status: "stopped" }
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: "Cannot stop torrent"
      });
    }
  } catch (error) {
    next(error);
  }
});

// Get torrent status
router.get("/sessions/:sessionId/status", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const status = getTorrentStatus(sessionId);
    res.json({ 
      success: true, 
      data: status ?? {
        sessionId,
        status: session.status,
        progress: session.progress,
        isDownloading: false,
        peerCount: session.peers.length,
        activePeerCount: 0,
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
