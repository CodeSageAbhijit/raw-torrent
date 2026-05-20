/**
 * PEX (Peer Exchange) - BEP 11
 * Allows peers to exchange lists of other peers they're connected to.
 * This significantly increases peer discovery without relying on trackers.
 */

import { EventEmitter } from "node:events";
import type { PeerConnection } from "./peer";
import { logger } from "../utils/logger";
import { PEX_RATE_LIMIT_MS } from "./pex/constants";
import {
  buildPexMessage,
  decodeExtensionHandshake,
  decodePexPeers,
  getExtensionHandshakeId,
  getExtensionMessageId,
  getExtensionPayload,
  sendExtensionHandshake,
} from "./pex/protocol";
import type { PexPeer, PexState } from "./pex/types";
import { parsePeerKey } from "./pex/utils";

export type { PexPeer, PexState } from "./pex/types";

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

    sendExtensionHandshake(peerKey, connection);
    
    logger.info(`[PEX] Initialized for peer ${peerKey}`);
  }

  /**
   * Send BEP 10 extension handshake
   */
  /**
   * Handle incoming extension message
   */
  private handleExtensionMessage(peerKey: string, connection: PeerConnection, payload: Buffer): void {
    const extensionId = getExtensionMessageId(payload);
    if (extensionId === null) {
      return;
    }

    const data = getExtensionPayload(payload);

    if (extensionId === getExtensionHandshakeId()) {
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
      const state = this.peers.get(peerKey);
      if (!state) return;

      const { peerExtensionId, clientName } = decodeExtensionHandshake(data);
      if (peerExtensionId !== null) {
        state.peerExtensionId = peerExtensionId;
        logger.info(`[PEX] Peer ${peerKey} supports PEX (extension ID: ${state.peerExtensionId})`);
      }
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
      const decodedPeers = decodePexPeers(data);
      const newPeers: PexPeer[] = [];

      for (const peer of decodedPeers) {
        const peerString = `${peer.ip}:${peer.port}`;
        if (!this.allKnownPeers.has(peerString)) {
          this.allKnownPeers.add(peerString);
          newPeers.push(peer);
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
    if (Date.now() - state.lastPexTime < PEX_RATE_LIMIT_MS) return;
    state.lastPexTime = Date.now();

    const message = buildPexMessage(state, peers);

    connection.socket.write(message);
    logger.debug(`[PEX] Sent ${Math.min(peers.length, 50)} peers to ${peerKey}`);
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
    return Array.from(this.allKnownPeers).map(parsePeerKey);
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
