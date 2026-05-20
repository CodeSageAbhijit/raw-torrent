import { Router } from "express";
import fs from "node:fs";
import {
  getDownloadProgress,
  getDownloadedFile,
  getDownloadedFileInfo,
  getPeerDownloadStates,
  getPieceStates,
  getTorrentSession,
  getWebTorrentFile,
} from "../../services/torrentService";

const router = Router();

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
        discoveredPeers: session.peers.length,
        piecesCompleted: session.completedPieces.length,
        piecesTotal: session.pieceCount,
        eta: -1,
      },
    });
  } catch (error) {
    next(error);
  }
});

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

router.post("/sessions/:sessionId/open-folder", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      if (typeof res.status === "function") res.status(404);
      res.json({ success: false, error: "Session not found" });
      return;
    }

    const { getSessionStoragePaths, listResumableSessions } = await import("../../services/fileStorageService.js");
    const record = listResumableSessions().find((r: any) => r.sessionId === sessionId);
    const savePath = record?.savePath;
    const paths = getSessionStoragePaths(sessionId, session.fileName, savePath);

    const fsModule = await import("node:fs");
    const pathModule = await import("node:path");

    let folderToOpen = paths.sessionDir;

    if (savePath && fsModule.existsSync(savePath)) {
      folderToOpen = savePath;
    } else if (paths.finalFilePath && fsModule.existsSync(pathModule.dirname(paths.finalFilePath))) {
      folderToOpen = pathModule.dirname(paths.finalFilePath);
    }

    const os = await import("node:os");
    const { exec } = await import("node:child_process");
    let cmd = "";
    if (os.platform() === "win32") {
      cmd = `explorer.exe "${folderToOpen}"`;
    } else if (os.platform() === "darwin") {
      cmd = `open "${folderToOpen}"`;
    } else {
      cmd = `xdg-open "${folderToOpen}"`;
    }

    exec(cmd);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

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
      const fileSize = wtf.length;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const stream = wtf.createReadStream({ start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "application/octet-stream",
          "X-File-Name": safeFileName,
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName}"`,
          "X-File-Name": safeFileName,
        });
        wtf.createReadStream().pipe(res);
      }
      return;
    }

    const fileInfo = getDownloadedFileInfo(sessionId);

    if (fileInfo && fs.existsSync(fileInfo.path)) {
      const range = req.headers.range;
      const fileSize = fileInfo.size;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const stream = fs.createReadStream(fileInfo.path, { start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "application/octet-stream",
          "X-File-Name": safeFileName,
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName}"`,
          "X-File-Name": safeFileName,
        });
        fs.createReadStream(fileInfo.path).pipe(res);
      }
      return;
    }

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

export default router;
