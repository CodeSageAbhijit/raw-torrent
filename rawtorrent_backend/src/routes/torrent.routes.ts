import { Router } from "express";
import fs from "node:fs";
import multer from "multer";

import { listSessionEvents } from "../services/persistenceService";
import { 
  getTorrentSession, 
  getUserSessions, 
  startTorrent,
  parseTorrent,
  getDownloadProgress,
  getPieceStates,
  getPeerDownloadStates,
  getDownloadedFile,
  getDownloadedFileInfo,
  getWebTorrentFile,
  pauseTorrent,
  resumeTorrent,
  stopTorrent,
  deleteTorrentSession,
  getTorrentStatus,
  reannounceTorrentDiscovery,
  setSeedingEnabled,
  enforceTurboModeSeedingPolicy,
} from "../services/torrentService";
import { getGlobalSettings, setGlobalSettings } from "../settings";


const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/parse", upload.single("torrentFile"), async (req, res, next) => {
  try {
    const { magnetUri } = req.body ?? {};
    const fileBuffer = req.file?.buffer;
    const fileName = req.file?.originalname;

    if (!magnetUri && !fileBuffer) {
      res.status(400).json({ success: false, error: "Provide magnetUri or a torrentFile upload" });
      return;
    }

    const files = await parseTorrent({
      input: fileBuffer,
      magnetUri,
      fileName,
    });

    res.json({
      success: true,
      data: {
        files,
        isMultiFile: files.length > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Settings endpoints
router.get("/settings", (req, res) => {
  try {
    const settings = getGlobalSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get settings" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const body = req.body ?? {};
    const previousTurboMode = getGlobalSettings().turboMode;
    const updatedSettings = setGlobalSettings(body);

    let seedingDisabled = 0;
    if (updatedSettings.turboMode) {
      seedingDisabled = await enforceTurboModeSeedingPolicy();
    }

    const turboActivated = !previousTurboMode && updatedSettings.turboMode;
    const turboPolicyMessage = updatedSettings.turboMode
      ? seedingDisabled > 0
        ? ` Turbo Mode policy disabled seeding for ${seedingDisabled} session(s).`
        : turboActivated
          ? " Turbo Mode policy is active."
          : ""
      : "";

    res.json({
      success: true,
      data: updatedSettings,
      message: `Settings updated. New downloads will use these settings immediately.${turboPolicyMessage}`,
      metadata: {
        seedingDisabled,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update settings" });
  }
});

router.get("/choose-directory", async (req, res) => {
  const os = await import("node:os");
  const { exec } = await import("node:child_process");
  const platform = os.platform();
  
  let cmd = "";
  if (platform === "win32") {
      cmd = `powershell.exe -NoProfile -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.windows.forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Select Download Directory'; $f.ShowNewFolderButton=$true; $f.RootFolder='MyComputer'; $form = New-Object System.Windows.Forms.Form; $form.TopMost = $true; $form.ShowInTaskbar = $false; $form.WindowState = 'Minimized'; if($f.ShowDialog($form) -eq 'OK'){ [Console]::Write($f.SelectedPath) }"`;
  } else if (platform === "darwin") {
    cmd = `osascript -e 'tell application "System Events" to set f to choose folder with prompt "Select Download Directory"' -e 'POSIX path of f'`;
  } else {
    // Linux uses zenity
    cmd = `zenity --file-selection --directory --title="Select Download Directory"`;
  }

  exec(cmd, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: "Could not open directory picker" });
    }
    const result = stdout.trim();
    if (!result) {
      return res.json({ canceled: true });
    }
    res.json({ path: result });
  });
});

router.post("/start", upload.single("torrentFile"), async (req, res, next) => {
  try {
    const { magnetUri, sessionId, selectedFileIndices, savePath } = req.body ?? {};
    const fileBuffer = req.file?.buffer;
    const fileName = req.file?.originalname;

    const normalizeSelectedIndices = (value: unknown): number[] | undefined => {
      const parseArray = (source: unknown[]) => {
        const normalized = source
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 0);
        return normalized.length > 0 ? normalized : undefined;
      };

      if (Array.isArray(value)) {
        return parseArray(value);
      }

      if (typeof value === "string" && value.trim().length > 0) {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed)) {
            return parseArray(parsed);
          }
        } catch {
          const split = value.split(",").map((part) => part.trim()).filter(Boolean);
          return parseArray(split);
        }
      }

      return undefined;
    };

    if (!magnetUri && !fileBuffer) {
      res.status(400).json({ success: false, error: "Provide magnetUri or a torrentFile upload" });
      return;
    }

    const result = await startTorrent({
      input: fileBuffer,
      magnetUri,
      fileName,
      sessionId,
      userId: "local-user",
      selectedFileIndices: normalizeSelectedIndices(selectedFileIndices),
      savePath,
    });

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
        discoveredPeers: session.peers.length,
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

// Open the designated output folder natively
router.post("/sessions/:sessionId/open-folder", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await getTorrentSession(sessionId);

    if (!session) {
      if (typeof res.status === "function") res.status(404);
      res.json({ success: false, error: "Session not found" });
      return;
    }

    const { getSessionStoragePaths, listResumableSessions } = await import("../services/fileStorageService.js");
    const record = listResumableSessions().find((r: any) => r.sessionId === sessionId);
    const savePath = record?.savePath;
    const paths = getSessionStoragePaths(sessionId, session.fileName, savePath);
    
    // Determine the correct folder to open:
    // 1. If user chose a savePath, open that (it's the parent of the session subfolder)
    // 2. Otherwise, open the directory containing the final downloaded file
    // 3. Fallback to sessionDir
    const fsModule = await import("node:fs");
    const pathModule = await import("node:path");
    
    let folderToOpen = paths.sessionDir; // fallback
    
    if (savePath && fsModule.existsSync(savePath)) {
      // User chose a custom save location — open it directly
      folderToOpen = savePath;
    } else if (paths.finalFilePath && fsModule.existsSync(pathModule.dirname(paths.finalFilePath))) {
      // Open the folder containing the final file
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
      const status = getTorrentStatus(sessionId);
      res.json({ 
        success: true, 
        message: "Torrent paused",
        data: { status: "paused", progress: status?.progress ?? session.progress }
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
      const status = getTorrentStatus(sessionId);
      res.json({ 
        success: true, 
        message: "Torrent resumed",
        data: { status: "running", progress: status?.progress ?? session.progress }
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

// Delete a torrent session and remove related files from disk
router.delete("/sessions/:sessionId", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const result = await deleteTorrentSession(sessionId);

    res.json({
      success: true,
      message:
        result.removedSession || result.removedFiles
          ? "Torrent session and files deleted"
          : "Session already removed",
      data: result,
    });
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

// Toggle seeding for a torrent
router.post("/sessions/:sessionId/seeding", async (req, res, next) => {
  try {
    const sessionId = String(req.params.sessionId);
    const { enabled } = req.body ?? {};
    const session = await getTorrentSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    if (false) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    if (enabled === true && getGlobalSettings().turboMode) {
      res.status(400).json({
        success: false,
        error: "Seeding is disabled while Turbo Mode is active. Disable Turbo Mode first.",
        turboMode: true,
      });
      return;
    }

    const success = await setSeedingEnabled(sessionId, enabled === true);
    
    if (success) {
      res.json({ 
        success: true, 
        message: enabled ? "Seeding enabled" : "Seeding disabled",
        data: { seeding: enabled }
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: "Cannot change seeding status",
        currentStatus: session.status
      });
    }
  } catch (error) {
    next(error);
  }
});

// Force immediate tracker reannounce (useful when peer discovery is slow)
router.post("/sessions/:sessionId/reannounce", async (req, res, next) => {
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

    const success = await reannounceTorrentDiscovery(sessionId);

    if (!success) {
      res.status(400).json({
        success: false,
        error: "Unable to refresh tracker discovery for this session",
      });
      return;
    }

    res.json({
      success: true,
      message: "Tracker discovery refresh triggered",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
