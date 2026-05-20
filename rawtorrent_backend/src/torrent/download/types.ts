import type { PeerConnection } from "../peer";

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  piecesCompleted: number;
  piecesTotal: number;
  eta: number;
}

export interface PeerDownloadState {
  peerId: string;
  ip: string;
  port: number;
  connection: PeerConnection;
  bitfield: Set<number>;
  choked: boolean;
  interested: boolean;
  downloadedBytes: number;
  uploadedBytes: number;
  pendingRequests: Map<string, PendingRequest>;
  lastActivity: number;
}

export interface PendingRequest {
  pieceIndex: number;
  offset: number;
  length: number;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

export interface PieceDownloadState {
  index: number;
  hash: string;
  totalLength: number;
  blocks: Map<number, Buffer>;
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
  savePath?: string;
}
