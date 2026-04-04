import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import torrentRoutes from "./routes/torrent.routes";
import { setupWebSocket } from "./ws/socket";
import { logger } from "./utils/logger";

dotenv.config();

export const startServer = () => {
  const app = express();

  app.use(
    cors({
      origin: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ],
      credentials: true,
    })
  );

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "rawtorrent-backend", timestamp: Date.now() });
  });

  app.use("/torrent", torrentRoutes);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("Unhandled server error", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  const server = http.createServer(app);
  setupWebSocket(server);

  const port = Number(process.env.PORT ?? 4000);

  server.listen(port, () => {
    logger.info(`RawTorrent backend listening on port ${port}`);
  });

  return server;
};
