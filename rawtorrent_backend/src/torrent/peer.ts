import net from "node:net";
import { EventEmitter } from "node:events";
import { createHandshakeBuffer, parseHandshakeBuffer } from "./handshake";
import { decodeMessages, encodeMessage, messageIds } from "./messages";
import type { PeerDescriptor, PeerMessageFrame, PeerRuntimeState } from "../types/peer";
import { logger } from "../utils/logger";

export interface ConnectPeerOptions {
  infoHash: string;
  peerId: string;
  timeoutMs?: number;
}

export interface PeerConnection extends EventEmitter {
  socket: net.Socket;
  state: PeerRuntimeState;
  sendInterested: () => void;
  close: () => void;
}

export const connectToPeer = (
  peer: PeerDescriptor,
  options: ConnectPeerOptions
): Promise<PeerConnection> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: peer.ip, port: peer.port });
    const events = new EventEmitter() as PeerConnection;
    const runtimeState: PeerRuntimeState = {
      ...peer,
      connected: false,
      choked: true,
      interested: false,
      downloadedBytes: 0,
      uploadedBytes: 0,
      lastSeenAt: Date.now(),
    };

    let buffer = Buffer.alloc(0);
    let handshakeCompleted = false;
    let settled = false;

    events.socket = socket;
    events.state = runtimeState;
    events.sendInterested = () => {
      socket.write(encodeMessage(messageIds.interested));
      runtimeState.interested = true;
    };
    events.close = () => socket.end();

    const timeoutMs = options.timeoutMs ?? 10_000;
    const timeout = setTimeout(() => {
      socket.destroy(new Error(`Timed out connecting to peer ${peer.ip}:${peer.port}`));
    }, timeoutMs);

    socket.on("connect", () => {
      const handshake = createHandshakeBuffer(options.infoHash, options.peerId);
      socket.write(handshake);
      runtimeState.connected = true;
      runtimeState.lastSeenAt = Date.now();
      logger.debug("Connected to peer", peer);
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      runtimeState.lastSeenAt = Date.now();

      if (!handshakeCompleted && buffer.length >= 68) {
        const parsedHandshake = parseHandshakeBuffer(buffer.subarray(0, 68));

        if (parsedHandshake) {
          handshakeCompleted = true;
          // Store extension support info in runtime state
          (runtimeState as any).supportsExtensions = parsedHandshake.supportsExtensions;
          events.emit("handshake", parsedHandshake);
          buffer = buffer.subarray(68);
          events.emit("connected", runtimeState);
        }
      }

      const { messages, remainder } = decodeMessages(buffer);
      buffer = Buffer.from(remainder);

      messages.forEach((message: PeerMessageFrame) => {
        events.emit("message", message);
      });
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);

      if (events.listenerCount("error") > 0) {
        events.emit("error", error);
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      runtimeState.connected = false;
      events.emit("close");
    });

    events.on("handshake", () => {
      clearTimeout(timeout);
      events.sendInterested();

      if (!settled) {
        settled = true;
        resolve(events);
      }
    });
  });
};
