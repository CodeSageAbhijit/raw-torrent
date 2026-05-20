import { Router } from "express";
import controlRoutes from "./torrent/control.routes";
import downloadRoutes from "./torrent/download.routes";
import ingestRoutes from "./torrent/ingest.routes";
import sessionsRoutes from "./torrent/sessions.routes";
import settingsRoutes from "./torrent/settings.routes";

const router = Router();

router.use(ingestRoutes);
router.use(settingsRoutes);
router.use(sessionsRoutes);
router.use(downloadRoutes);
router.use(controlRoutes);

export default router;
