import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { torrentEventBus } from "../redis/publisher";
import { initSubscriber } from "../redis/subscriber";
import { logger } from "../utils/logger";
import type { TorrentEvent } from "../types/torrent";

const broadcastEvent = (wss: WebSocketServer, event: TorrentEvent) => {
  const payload = JSON.stringify(event);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

export const setupWebSocket = (server: http.Server) => {
  const wss = new WebSocketServer({ server, path: "/ws" });

  torrentEventBus.on("event", (event: TorrentEvent) => {
    broadcastEvent(wss, event);
  });

  initSubscriber((event) => {
    broadcastEvent(wss, event);
  });

  wss.on("connection", (socket) => {
    logger.info("WebSocket client connected");

    socket.send(
      JSON.stringify({
        type: "server_started",
        data: { message: "Connected to RawTorrent backend" },
        timestamp: Date.now(),
      })
    );
  });

  return wss;
};
