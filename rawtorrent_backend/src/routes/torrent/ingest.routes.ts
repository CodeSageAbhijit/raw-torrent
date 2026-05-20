import { Router } from "express";
import multer from "multer";
import {
  parseTorrent,
  startTorrent,
} from "../../services/torrentService";
import { normalizeSelectedIndices } from "./utils";

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

router.post("/start", upload.single("torrentFile"), async (req, res, next) => {
  try {
    const { magnetUri, sessionId, selectedFileIndices, savePath } = req.body ?? {};
    const fileBuffer = req.file?.buffer;
    const fileName = req.file?.originalname;

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

export default router;
