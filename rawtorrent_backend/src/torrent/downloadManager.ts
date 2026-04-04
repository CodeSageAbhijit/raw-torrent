import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import type { PeerConnection } from "./peer";
import { encodeMessage, messageIds } from "./messages";
import type { PieceState } from "./pieceManager";
import { logger } from "../utils/logger";
import {
  ensureSessionStorage,
  getSessionStoragePaths,
  loadSessionState,
  persistSessionState,
  piecePath,
  type SessionStoragePaths,
} from "../services/fileStorageService";

// Standard BitTorrent block size: 16KB
const BLOCK_SIZE = 16384;
// Max concurrent requests per peer
const MAX_REQUESTS_PER_PEER = 10;
// Request timeout
const REQUEST_TIMEOUT_MS = 30000;

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  piecesCompleted: number;
  piecesTotal: number;
  eta: number; // seconds
}

export interface PeerDownloadState {
  peerId: string;
  ip: string;
  port: number;
  connection: PeerConnection;
  bitfield: Set<number>; // Pieces this peer has
  choked: boolean;
  interested: boolean;
  downloadedBytes: number;
  uploadedBytes: number;
  pendingRequests: Map<string, PendingRequest>; // "pieceIndex:offset" -> request
  lastActivity: number;
}

interface PendingRequest {
  pieceIndex: number;
  offset: number;
  length: number;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

interface PieceDownloadState {
  index: number;
  hash: string;
  totalLength: number;
  blocks: Map<number, Buffer>; // offset -> data
  blocksNeeded: number;
  blocksReceived: number;
  assignedPeer: string | null;
}

export interface DownloadManagerOptions {
  sessionId: string;
  infoHash: string;
  pieceHashes: string[];
  pieceLength: number;
  totalLength: number;
  fileName: string;
}

export class DownloadManager extends EventEmitter {
  private readonly sessionId: string;
  private readonly infoHash: string;
  private readonly pieceHashes: string[];
  private readonly pieceLength: number;
  private readonly totalLength: number;
  private readonly fileName: string;
  private readonly storage: SessionStoragePaths;

  private peers = new Map<string, PeerDownloadState>();
  private pieces = new Map<number, PieceDownloadState>();
  private completedPieces = new Set<number>();

  private downloadedBytes = 0;
  private uploadedBytes = 0;
  private lastSpeedCalcTime = Date.now();
  private lastDownloadedBytes = 0;
  private downloadSpeed = 0;
  private lastStatePersistAt = 0;
  private statePersistTimer: NodeJS.Timeout | null = null;

  private isRunning = false;
  private downloadInterval: NodeJS.Timeout | null = null;

  constructor(options: DownloadManagerOptions) {
    super();
    this.sessionId = options.sessionId;
    this.infoHash = options.infoHash;
    this.pieceHashes = options.pieceHashes;
    this.pieceLength = options.pieceLength;
    this.totalLength = options.totalLength;
    this.fileName = options.fileName;
    this.storage = getSessionStoragePaths(options.sessionId, options.fileName);
    ensureSessionStorage(this.storage);

    // Initialize piece states
    for (let i = 0; i < this.pieceHashes.length; i++) {
      const isLastPiece = i === this.pieceHashes.length - 1;
      const pieceLen = isLastPiece 
        ? this.totalLength - i * this.pieceLength 
        : this.pieceLength;
      
      this.pieces.set(i, {
        index: i,
        hash: this.pieceHashes[i],
        totalLength: pieceLen,
        blocks: new Map(),
        blocksNeeded: Math.ceil(pieceLen / BLOCK_SIZE),
        blocksReceived: 0,
        assignedPeer: null,
      });
    }

    this.restoreStateFromDisk();
  }

  // Add a connected peer to the download manager
  addPeer(connection: PeerConnection, peerId: string, ip: string, port: number): void {
    const peerKey = `${ip}:${port}`;
    
    if (this.peers.has(peerKey)) {
      logger.warn(`Peer ${peerKey} already exists in download manager`);
      return;
    }

    const peerState: PeerDownloadState = {
      peerId,
      ip,
      port,
      connection,
      bitfield: new Set(),
      choked: true,
      interested: false,
      downloadedBytes: 0,
      uploadedBytes: 0,
      pendingRequests: new Map(),
      lastActivity: Date.now(),
    };

    this.peers.set(peerKey, peerState);
    logger.info(`[DownloadManager] ➕ Added peer ${peerKey} (total: ${this.peers.size})`);

    // Listen for peer messages
    connection.on("message", (message) => {
      logger.debug(`[DownloadManager] 📨 Message from ${peerKey}: id=${message.id}`);
      this.handlePeerMessage(peerKey, message);
    });

    connection.on("error", (err) => {
      logger.warn(`[DownloadManager] Peer ${peerKey} error: ${err?.message || err}`);
      this.removePeer(peerKey);
    });

    connection.on("close", () => {
      logger.info(`[DownloadManager] Peer ${peerKey} closed`);
      this.removePeer(peerKey);
    });

    this.emit("peer_added", { ip, port, peerId });

    // Send interested message (note: peer.ts already sends this on handshake)
    this.sendInterested(peerKey);
  }

  removePeer(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    // Cancel all pending requests for this peer
    for (const [requestKey, request] of peer.pendingRequests) {
      clearTimeout(request.timeout);
      // Reassign piece to another peer
      const piece = this.pieces.get(request.pieceIndex);
      if (piece) {
        piece.assignedPeer = null;
      }
    }

    this.peers.delete(peerKey);
    this.emit("peer_removed", { ip: peer.ip, port: peer.port });
    
    // Try to schedule more downloads
    this.scheduleDownloads();
  }

  private sendInterested(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer || peer.interested) return;

    peer.connection.socket.write(encodeMessage(messageIds.interested));
    peer.interested = true;
    logger.debug(`Sent INTERESTED to ${peerKey}`);
  }

  private handlePeerMessage(peerKey: string, message: { id: number | null; payload: Buffer }): void {
    if (!this.isRunning) {
      return;
    }

    const peer = this.peers.get(peerKey);
    if (!peer) return;

    peer.lastActivity = Date.now();

    switch (message.id) {
      case messageIds.choke:
        this.handleChoke(peerKey);
        break;
      case messageIds.unchoke:
        this.handleUnchoke(peerKey);
        break;
      case messageIds.have:
        this.handleHave(peerKey, message.payload);
        break;
      case messageIds.bitfield:
        this.handleBitfield(peerKey, message.payload);
        break;
      case messageIds.piece:
        this.handlePiece(peerKey, message.payload);
        break;
      default:
        // Ignore other messages for now
        break;
    }
  }

  private handleChoke(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    peer.choked = true;
    this.emit("peer_choked", { ip: peer.ip, port: peer.port });
    logger.debug(`Peer ${peerKey} choked us`);

    // Cancel pending requests and reassign pieces
    for (const [, request] of peer.pendingRequests) {
      clearTimeout(request.timeout);
      const piece = this.pieces.get(request.pieceIndex);
      if (piece) {
        piece.assignedPeer = null;
      }
    }
    peer.pendingRequests.clear();
  }

  private handleUnchoke(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    peer.choked = false;
    this.emit("peer_unchoked", { ip: peer.ip, port: peer.port });
    logger.info(`[DownloadManager] 🔓 UNCHOKED by ${peerKey} - starting piece requests!`);

    // Start requesting pieces
    this.scheduleDownloads();
  }

  private handleHave(peerKey: string, payload: Buffer): void {
    const peer = this.peers.get(peerKey);
    if (!peer || payload.length < 4) return;

    const pieceIndex = payload.readUInt32BE(0);
    peer.bitfield.add(pieceIndex);

    this.emit("peer_has_piece", { ip: peer.ip, port: peer.port, pieceIndex });
    logger.debug(`Peer ${peerKey} has piece ${pieceIndex}`);

    // Schedule downloads if this peer is unchoked
    if (!peer.choked) {
      this.scheduleDownloads();
    }
  }

  private handleBitfield(peerKey: string, payload: Buffer): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    // Parse bitfield
    for (let byteIndex = 0; byteIndex < payload.length; byteIndex++) {
      const byte = payload[byteIndex];
      for (let bit = 0; bit < 8; bit++) {
        const pieceIndex = byteIndex * 8 + bit;
        if (pieceIndex >= this.pieceHashes.length) break;
        
        if ((byte & (1 << (7 - bit))) !== 0) {
          peer.bitfield.add(pieceIndex);
        }
      }
    }

    this.emit("peer_bitfield", { 
      ip: peer.ip, 
      port: peer.port, 
      piecesCount: peer.bitfield.size,
      piecesAvailable: peer.bitfield.size 
    });
    logger.info(`Peer ${peerKey} bitfield: has ${peer.bitfield.size}/${this.pieceHashes.length} pieces`);
  }

  private handlePiece(peerKey: string, payload: Buffer): void {
    const peer = this.peers.get(peerKey);
    if (!peer || payload.length < 8) return;

    const pieceIndex = payload.readUInt32BE(0);
    const offset = payload.readUInt32BE(4);
    const data = payload.subarray(8);

    const requestKey = `${pieceIndex}:${offset}`;
    const pendingRequest = peer.pendingRequests.get(requestKey);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      peer.pendingRequests.delete(requestKey);
    }

    const piece = this.pieces.get(pieceIndex);
    if (!piece || this.completedPieces.has(pieceIndex)) return;

    // Store block data
    piece.blocks.set(offset, data);
    piece.blocksReceived++;

    // Update stats
    peer.downloadedBytes += data.length;
    this.downloadedBytes += data.length;

    this.emit("block_received", {
      pieceIndex,
      offset,
      length: data.length,
      peer: { ip: peer.ip, port: peer.port },
    });

    // Check if piece is complete
    if (piece.blocksReceived >= piece.blocksNeeded) {
      this.assemblePiece(pieceIndex);
    }

    // Schedule more downloads
    this.scheduleDownloads();
  }

  private assemblePiece(pieceIndex: number): void {
    const piece = this.pieces.get(pieceIndex);
    if (!piece) return;

    // Assemble blocks in order
    const sortedOffsets = Array.from(piece.blocks.keys()).sort((a, b) => a - b);
    const buffers: Buffer[] = [];
    
    for (const offset of sortedOffsets) {
      const block = piece.blocks.get(offset);
      if (block) buffers.push(block);
    }

    const pieceData = Buffer.concat(buffers);

    // Verify SHA1 hash
    const hash = crypto.createHash("sha1").update(pieceData).digest("hex");
    
    if (hash !== piece.hash) {
      logger.warn(`Piece ${pieceIndex} hash mismatch! Expected: ${piece.hash}, Got: ${hash}`);
      // Reset piece and retry
      piece.blocks.clear();
      piece.blocksReceived = 0;
      piece.assignedPeer = null;
      this.emit("piece_failed", { pieceIndex, reason: "hash_mismatch" });
      return;
    }

    // Piece verified successfully
    this.completedPieces.add(pieceIndex);
    this.writePieceToDisk(pieceIndex, pieceData);
    piece.blocks.clear(); // Free memory
    this.persistStateToDisk();

    this.emit("piece_verified", {
      pieceIndex,
      hash,
      length: pieceData.length,
    });

    logger.info(`Piece ${pieceIndex} verified successfully (${this.completedPieces.size}/${this.pieceHashes.length})`);

    // Emit progress update
    this.emitProgress();

    // Check if download is complete
    if (this.completedPieces.size === this.pieceHashes.length) {
      this.onDownloadComplete();
    }
  }

  private scheduleDownloads(): void {
    if (!this.isRunning) return;

    let unchokedPeers = 0;
    let piecesRequested = 0;

    // For each unchoked peer with available request slots
    for (const [peerKey, peer] of this.peers) {
      if (peer.choked) continue;
      unchokedPeers++;
      if (peer.pendingRequests.size >= MAX_REQUESTS_PER_PEER) continue;

      // Find pieces this peer has that we need
      for (const pieceIndex of peer.bitfield) {
        if (this.completedPieces.has(pieceIndex)) continue;
        
        const piece = this.pieces.get(pieceIndex);
        if (!piece) continue;
        
        // Check if piece is assigned to another peer
        if (piece.assignedPeer && piece.assignedPeer !== peerKey) continue;

        // Assign piece to this peer
        piece.assignedPeer = peerKey;
        piecesRequested++;

        // Request missing blocks
        for (let offset = 0; offset < piece.totalLength; offset += BLOCK_SIZE) {
          if (piece.blocks.has(offset)) continue;
          if (peer.pendingRequests.size >= MAX_REQUESTS_PER_PEER) break;

          const blockLength = Math.min(BLOCK_SIZE, piece.totalLength - offset);
          this.requestBlock(peerKey, pieceIndex, offset, blockLength);
        }

        if (peer.pendingRequests.size >= MAX_REQUESTS_PER_PEER) break;
      }
    }
    
    // Log schedule summary every few calls
    if (unchokedPeers > 0 || piecesRequested > 0) {
      logger.info(`[Schedule] ${unchokedPeers} unchoked peers, ${piecesRequested} pieces being requested, ${this.completedPieces.size}/${this.pieceHashes.length} complete`);
    }
  }

  private requestBlock(peerKey: string, pieceIndex: number, offset: number, length: number): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;

    const requestKey = `${pieceIndex}:${offset}`;
    if (peer.pendingRequests.has(requestKey)) return;

    // Build REQUEST message: index (4) + begin (4) + length (4)
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE(pieceIndex, 0);
    payload.writeUInt32BE(offset, 4);
    payload.writeUInt32BE(length, 8);

    peer.connection.socket.write(encodeMessage(messageIds.request, payload));

    // Track pending request with timeout
    const timeout = setTimeout(() => {
      this.handleRequestTimeout(peerKey, requestKey, pieceIndex);
    }, REQUEST_TIMEOUT_MS);

    peer.pendingRequests.set(requestKey, {
      pieceIndex,
      offset,
      length,
      timestamp: Date.now(),
      timeout,
    });

    this.emit("block_requested", {
      pieceIndex,
      offset,
      length,
      peer: { ip: peer.ip, port: peer.port },
    });
  }

  private handleRequestTimeout(peerKey: string, requestKey: string, pieceIndex: number): void {
    const peer = this.peers.get(peerKey);
    if (peer) {
      peer.pendingRequests.delete(requestKey);
    }

    // Reassign piece
    const piece = this.pieces.get(pieceIndex);
    if (piece && piece.assignedPeer === peerKey) {
      piece.assignedPeer = null;
    }

    logger.warn(`Request timeout for ${requestKey} from ${peerKey}`);
    this.scheduleDownloads();
  }

  private onDownloadComplete(): void {
    this.isRunning = false;
    
    if (this.downloadInterval) {
      clearInterval(this.downloadInterval);
      this.downloadInterval = null;
    }

    // Assemble complete file on disk to avoid large RAM allocations.
    const fileInfo = this.assembleFileOnDisk();

    this.emit("download_complete", {
      fileName: this.fileName,
      totalBytes: this.totalLength,
      filePath: fileInfo.path,
    });

    logger.info(`Download complete: ${this.fileName} (${this.totalLength} bytes)`);
  }

  private assembleFileOnDisk(): { path: string; size: number } {
    const fileDescriptor = fs.openSync(this.storage.finalFilePath, "w");

    try {
      let offset = 0;

      for (let index = 0; index < this.pieceHashes.length; index += 1) {
        const currentPiecePath = piecePath(this.storage, index);

        if (!fs.existsSync(currentPiecePath)) {
          throw new Error(`Missing piece file ${index} during final assembly`);
        }

        const chunk = fs.readFileSync(currentPiecePath);
        fs.writeSync(fileDescriptor, chunk, 0, chunk.length, offset);
        offset += chunk.length;
      }

      return {
        path: this.storage.finalFilePath,
        size: offset,
      };
    } finally {
      fs.closeSync(fileDescriptor);
    }
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.emit("download_started", {
      fileName: this.fileName,
      totalBytes: this.totalLength,
      totalPieces: this.pieceHashes.length,
    });

    // Start speed calculation interval
    this.downloadInterval = setInterval(() => {
      this.calculateSpeed();
      this.emitProgress();
    }, 1000);

    // Start requesting pieces
    this.scheduleDownloads();
  }

  stop(): void {
    this.isRunning = false;
    
    if (this.downloadInterval) {
      clearInterval(this.downloadInterval);
      this.downloadInterval = null;
    }

    // Cancel all pending requests
    for (const [, peer] of this.peers) {
      for (const [, request] of peer.pendingRequests) {
        clearTimeout(request.timeout);
      }
      peer.pendingRequests.clear();

      try {
        peer.connection.close();
      } catch {
        // Ignore close errors during stop.
      }
    }

    this.peers.clear();
    this.persistStateToDisk(true);

    this.emit("download_stopped", {});
  }

  private calculateSpeed(): void {
    const now = Date.now();
    const elapsed = (now - this.lastSpeedCalcTime) / 1000;
    
    if (elapsed > 0) {
      this.downloadSpeed = (this.downloadedBytes - this.lastDownloadedBytes) / elapsed;
      this.lastDownloadedBytes = this.downloadedBytes;
      this.lastSpeedCalcTime = now;
    }
  }

  private emitProgress(): void {
    const eta = this.downloadSpeed > 0 
      ? Math.round((this.totalLength - this.downloadedBytes) / this.downloadSpeed)
      : -1;

    const progress: DownloadProgress = {
      totalBytes: this.totalLength,
      downloadedBytes: this.downloadedBytes,
      progress: Math.round((this.downloadedBytes / this.totalLength) * 100 * 100) / 100,
      downloadSpeed: this.downloadSpeed,
      uploadSpeed: 0, // TODO: implement seeding
      activePeers: Array.from(this.peers.values()).filter(p => !p.choked).length,
      piecesCompleted: this.completedPieces.size,
      piecesTotal: this.pieceHashes.length,
      eta,
    };

    this.emit("progress", progress);
  }

  getProgress(): DownloadProgress {
    const eta = this.downloadSpeed > 0 
      ? Math.round((this.totalLength - this.downloadedBytes) / this.downloadSpeed)
      : -1;

    return {
      totalBytes: this.totalLength,
      downloadedBytes: this.downloadedBytes,
      progress: Math.round((this.downloadedBytes / this.totalLength) * 100 * 100) / 100,
      downloadSpeed: this.downloadSpeed,
      uploadSpeed: 0,
      activePeers: Array.from(this.peers.values()).filter(p => !p.choked).length,
      piecesCompleted: this.completedPieces.size,
      piecesTotal: this.pieceHashes.length,
      eta,
    };
  }

  getPieceStates(): PieceState[] {
    return Array.from(this.pieces.values()).map(p => ({
      index: p.index,
      hash: p.hash,
      length: p.totalLength,
      requested: p.assignedPeer !== null,
      completed: this.completedPieces.has(p.index),
    }));
  }

  getPeerStates() {
    return Array.from(this.peers.values()).map(peer => ({
      ip: peer.ip,
      port: peer.port,
      peerId: peer.peerId,
      choked: peer.choked,
      piecesAvailable: peer.bitfield.size,
      downloadedBytes: peer.downloadedBytes,
      pendingRequests: peer.pendingRequests.size,
    }));
  }

  // Get piece data for streaming to client
  getPieceData(pieceIndex: number): Buffer | null {
    const currentPiecePath = piecePath(this.storage, pieceIndex);

    if (!fs.existsSync(currentPiecePath)) {
      return null;
    }

    return fs.readFileSync(currentPiecePath);
  }

  // Get all completed piece data
  getFileBuffer(): Buffer | null {
    if (this.completedPieces.size !== this.pieceHashes.length) {
      return null;
    }
    try {
      if (fs.existsSync(this.storage.finalFilePath)) {
        return fs.readFileSync(this.storage.finalFilePath);
      }

      const assembled = this.assembleFileOnDisk();
      return fs.readFileSync(assembled.path);
    } catch (err) {
      logger.error(`Failed to assemble file: ${err}`);
      return null;
    }
  }

  // Check if download is in progress
  isDownloading(): boolean {
    return this.isRunning;
  }

  // Get total peer count
  getPeerCount(): number {
    return this.peers.size;
  }

  // Get count of unchoked (active) peers
  getActivePeerCount(): number {
    return Array.from(this.peers.values()).filter(p => !p.choked).length;
  }

  // Get partial file buffer (for incomplete downloads)
  getPartialFileBuffer(): { buffer: Buffer; completedPieces: number[]; totalPieces: number } | null {
    if (this.completedPieces.size === 0) {
      return null;
    }

    const buffers: Buffer[] = [];
    const completedPieces: number[] = [];

    for (let i = 0; i < this.pieceHashes.length; i++) {
      const pieceData = this.getPieceData(i);
      if (pieceData) {
        buffers.push(pieceData);
        completedPieces.push(i);
      } else {
        // Fill missing pieces with zeros (placeholder)
        const pieceLen = i === this.pieceHashes.length - 1
          ? this.totalLength - i * this.pieceLength
          : this.pieceLength;
        buffers.push(Buffer.alloc(pieceLen, 0));
      }
    }

    return {
      buffer: Buffer.concat(buffers),
      completedPieces,
      totalPieces: this.pieceHashes.length,
    };
  }

  // Get download state for persistence
  getDownloadState(): {
    completedPieces: number[];
    downloadedBytes: number;
  } {
    return {
      completedPieces: Array.from(this.completedPieces),
      downloadedBytes: this.downloadedBytes,
    };
  }

  // Restore download state (for resume after reload)
  restoreDownloadState(state: {
    completedPieces: number[];
    downloadedBytes: number;
  }): void {
    this.completedPieces = new Set(state.completedPieces);
    this.downloadedBytes = state.downloadedBytes;

    // Mark restored pieces as complete in piece state
    for (const pieceIndex of state.completedPieces) {
      const piece = this.pieces.get(pieceIndex);
      if (piece) {
        piece.blocksReceived = piece.blocksNeeded;
      }
    }

    logger.info(`Restored download state: ${this.completedPieces.size}/${this.pieceHashes.length} pieces`);
  }

  getStoragePaths() {
    return {
      sessionDir: this.storage.sessionDir,
      piecesDir: this.storage.piecesDir,
      finalFilePath: this.storage.finalFilePath,
      stateFilePath: this.storage.stateFilePath,
      metadataFilePath: this.storage.metadataFilePath,
    };
  }

  getCompletedFileInfo(): { path: string; size: number } | null {
    if (!fs.existsSync(this.storage.finalFilePath)) {
      return null;
    }

    const stats = fs.statSync(this.storage.finalFilePath);
    return {
      path: this.storage.finalFilePath,
      size: stats.size,
    };
  }

  private writePieceToDisk(pieceIndex: number, data: Buffer) {
    fs.writeFileSync(piecePath(this.storage, pieceIndex), data);
  }

  private persistStateToDisk(force = false) {
    const now = Date.now();
    const minIntervalMs = Number(process.env.STATE_WRITE_INTERVAL_MS ?? 750);

    if (!force && now - this.lastStatePersistAt < minIntervalMs) {
      if (!this.statePersistTimer) {
        this.statePersistTimer = setTimeout(() => {
          this.statePersistTimer = null;
          this.persistStateToDisk(true);
        }, minIntervalMs);
      }
      return;
    }

    this.lastStatePersistAt = now;
    persistSessionState(this.storage, {
      completedPieces: Array.from(this.completedPieces),
      downloadedBytes: this.downloadedBytes,
    });
  }

  private restoreStateFromDisk() {
    const state = loadSessionState(this.storage);
    if (!state) {
      return;
    }

    const validatedPieces: number[] = [];

    for (const pieceIndex of state.completedPieces) {
      const currentPiecePath = piecePath(this.storage, pieceIndex);

      if (!fs.existsSync(currentPiecePath)) {
        continue;
      }

      try {
        const chunk = fs.readFileSync(currentPiecePath);
        const hash = crypto.createHash("sha1").update(chunk).digest("hex");

        if (hash !== this.pieceHashes[pieceIndex]) {
          fs.unlinkSync(currentPiecePath);
          continue;
        }

        validatedPieces.push(pieceIndex);
      } catch {
        // Ignore corrupted piece and continue.
      }
    }

    this.restoreDownloadState({
      completedPieces: validatedPieces,
      downloadedBytes: validatedPieces.reduce((sum, index) => sum + this.pieces.get(index)!.totalLength, 0),
    });
  }
}
