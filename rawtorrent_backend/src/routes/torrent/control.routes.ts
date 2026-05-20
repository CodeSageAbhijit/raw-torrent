import { Router } from "express";
import {
  deleteTorrentSession,
  getTorrentSession,
  getTorrentStatus,
  pauseTorrent,
  reannounceTorrentDiscovery,
  resumeTorrent,
  setSeedingEnabled,
  stopTorrent,
} from "../../services/torrentService";
import { getGlobalSettings } from "../../settings";

const router = Router();

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
        data: { status: "paused", progress: status?.progress ?? session.progress },
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Cannot pause torrent",
        currentStatus: session.status,
      });
    }
  } catch (error) {
    next(error);
  }
});

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
        data: { status: "running", progress: status?.progress ?? session.progress },
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Cannot resume torrent",
        currentStatus: session.status,
      });
    }
  } catch (error) {
    next(error);
  }
});

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
        data: { status: "stopped" },
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Cannot stop torrent",
      });
    }
  } catch (error) {
    next(error);
  }
});

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
      },
    });
  } catch (error) {
    next(error);
  }
});

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
        data: { seeding: enabled },
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Cannot change seeding status",
        currentStatus: session.status,
      });
    }
  } catch (error) {
    next(error);
  }
});

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
