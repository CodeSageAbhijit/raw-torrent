/**
 * PEX (Peer Exchange) - BEP 11
 * Allows peers to exchange lists of other peers they're connected to.
 * This significantly increases peer discovery without relying on trackers.
 */

import bencode from "bencode";
import { EventEmitter } from "node:events";
import type { PeerConnection } from "./peer";
import { logger } from "../utils/logger";

// Extension message IDs
const EXTENSION_HANDSHAKE_ID = 0;
const UT_PEX_NAME = "ut_pex";

export interface PexPeer {
  ip: string;
  port: number;
}

export interface PexState {
  peerExtensionId: number | null; // Their ut_pex ID
  ourExtensionId: number; // Our ut_pex ID (always 1)
  supportsExtensions: boolean;
  knownPeers: Set<string>; // "ip:port"
  lastPexTime: number;
}

export class PexManager extends EventEmitter {
  private peers = new Map<string, PexState>(); // peerKey -> state
  private allKnownPeers = new Set<string>(); // Global set of all discovered peers
  private pexInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize PEX for a peer after handshake
   */
  initPeer(peerKey: string, connection: PeerConnection, supportsExtensions: boolean): void {
    if (!supportsExtensions) {
      logger.debug(`[PEX] Peer ${peerKey} doesn't support extensions`);
      return;
    }

    const state: PexState = {
      peerExtensionId: null,
      ourExtensionId: 1,
      supportsExtensions: true,
      knownPeers: new Set(),
      lastPexTime: 0,
    };

    this.peers.set(peerKey, state);

    // Listen for extension messages
    connection.on("message", (message) => {
      if (message.id === 20) { // Extended message
        this.handleExtensionMessage(peerKey, connection, message.payload);
      }
    });

    // Send extension handshake
    this.sendExtensionHandshake(peerKey, connection);
    
    logger.info(`[PEX] Initialized for peer ${peerKey}`);
  }

  /**
   * Send BEP 10 extension handshake
   */
  private sendExtensionHandshake(peerKey: string, connection: PeerConnection): void {
    const handshake = {
      m: {
        [UT_PEX_NAME]: 1, // We support ut_pex at extension ID 1
      },
      v: "RawTorrent 1.0", // Client name
      reqq: 250, // Request queue depth
    };

    const encoded = bencode.encode(handshake);
    const message = Buffer.alloc(6 + encoded.length);
    
    // Length prefix (4 bytes)
    message.writeUInt32BE(2 + encoded.length, 0);
    // Message ID 20 = extended
    message.writeUInt8(20, 4);
    // Extension message ID 0 = handshake
    message.writeUInt8(EXTENSION_HANDSHAKE_ID, 5);
    // Payload
    encoded.copy(message, 6);

    connection.socket.write(message);
    logger.debug(`[PEX] Sent extension handshake to ${peerKey}`);
  }

  /**
   * Handle incoming extension message
   */
  private handleExtensionMessage(peerKey: string, connection: PeerConnection, payload: Buffer): void {
    if (payload.length < 1) return;

    const extensionId = payload.readUInt8(0);
    const data = payload.subarray(1);

    if (extensionId === EXTENSION_HANDSHAKE_ID) {
      this.handleExtensionHandshake(peerKey, data);
    } else {
      const state = this.peers.get(peerKey);
      if (state && extensionId === state.ourExtensionId) {
        // This is a ut_pex message for us
        this.handlePexMessage(peerKey, data);
      }
    }
  }

  /**
   * Handle peer's extension handshake response
   */
  private handleExtensionHandshake(peerKey: string, data: Buffer): void {
    try {
      const decoded = bencode.decode(data) as { m?: { ut_pex?: number }; v?: Buffer };
      const state = this.peers.get(peerKey);
      
      if (!state) return;

      if (decoded.m && typeof decoded.m[UT_PEX_NAME] === "number") {
        state.peerExtensionId = decoded.m[UT_PEX_NAME];
        logger.info(`[PEX] Peer ${peerKey} supports PEX (extension ID: ${state.peerExtensionId})`);
      }

      const clientName = decoded.v ? decoded.v.toString() : "unknown";
      logger.debug(`[PEX] Peer ${peerKey} client: ${clientName}`);
    } catch (e) {
      logger.warn(`[PEX] Failed to parse extension handshake from ${peerKey}`);
    }
  }

  /**
   * Handle incoming PEX message with peer list
   */
  private handlePexMessage(peerKey: string, data: Buffer): void {
    try {
      const decoded = bencode.decode(data) as { 
        added?: Buffer; 
        "added.f"?: Buffer;
        dropped?: Buffer;
      };

      const newPeers: PexPeer[] = [];

      // Parse added peers (6 bytes each: 4 IP + 2 port)
      if (decoded.added && Buffer.isBuffer(decoded.added)) {
        for (let i = 0; i + 6 <= decoded.added.length; i += 6) {
          const ip = `${decoded.added[i]}.${decoded.added[i + 1]}.${decoded.added[i + 2]}.${decoded.added[i + 3]}`;
          const port = decoded.added.readUInt16BE(i + 4);
          
          if (port > 0 && port < 65536) {
            const peerString = `${ip}:${port}`;
            if (!this.allKnownPeers.has(peerString)) {
              this.allKnownPeers.add(peerString);
              newPeers.push({ ip, port });
            }
          }
        }
      }

      if (newPeers.length > 0) {
        logger.info(`[PEX] 📥 Got ${newPeers.length} new peers from ${peerKey} (total known: ${this.allKnownPeers.size})`);
        this.emit("peers_discovered", newPeers);
      }
    } catch (e) {
      logger.warn(`[PEX] Failed to parse PEX message from ${peerKey}`);
    }
  }

  /**
   * Send PEX message to a peer with our known peers
   */
  sendPexMessage(peerKey: string, connection: PeerConnection, peers: PexPeer[]): void {
    const state = this.peers.get(peerKey);
    if (!state || state.peerExtensionId === null) return;

    // Rate limit: max 1 PEX message per minute per peer
    if (Date.now() - state.lastPexTime < 60000) return;
    state.lastPexTime = Date.now();

    // Build added peers buffer (max 50 peers)
    const peersToSend = peers.slice(0, 50);
    const added = Buffer.alloc(peersToSend.length * 6);
    
    peersToSend.forEach((peer, i) => {
      const parts = peer.ip.split(".").map(Number);
      added[i * 6] = parts[0];
      added[i * 6 + 1] = parts[1];
      added[i * 6 + 2] = parts[2];
      added[i * 6 + 3] = parts[3];
      added.writeUInt16BE(peer.port, i * 6 + 4);
    });

    const pexData = { added };
    const encoded = bencode.encode(pexData);
    
    const message = Buffer.alloc(6 + encoded.length);
    message.writeUInt32BE(2 + encoded.length, 0);
    message.writeUInt8(20, 4); // Extended message
    message.writeUInt8(state.peerExtensionId, 5); // Their ut_pex ID
    encoded.copy(message, 6);

    connection.socket.write(message);
    logger.debug(`[PEX] Sent ${peersToSend.length} peers to ${peerKey}`);
  }

  /**
   * Remove peer from PEX tracking
   */
  removePeer(peerKey: string): void {
    this.peers.delete(peerKey);
  }

  /**
   * Get count of PEX-capable peers
   */
  getPexPeerCount(): number {
    let count = 0;
    for (const state of this.peers.values()) {
      if (state.peerExtensionId !== null) count++;
    }
    return count;
  }

  /**
   * Get all known peers from PEX
   */
  getAllKnownPeers(): PexPeer[] {
    return Array.from(this.allKnownPeers).map(peerStr => {
      const [ip, portStr] = peerStr.split(":");
      return { ip, port: parseInt(portStr, 10) };
    });
  }

  stop(): void {
    if (this.pexInterval) {
      clearInterval(this.pexInterval);
      this.pexInterval = null;
    }
    this.peers.clear();
  }
}

// Singleton for global PEX management
export const pexManager = new PexManager();
