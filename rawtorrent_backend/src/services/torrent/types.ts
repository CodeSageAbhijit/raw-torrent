export type DownloadProgress = {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  discoveredPeers: number;
  piecesCompleted: number;
  piecesTotal: number;
  eta: number;
  downloadSpeedMbps: string;
  etaFormatted: string;
};

export type PieceState = {
  index: number;
  hash: string;
  length: number;
  requested: boolean;
  completed: boolean;
};

export type PeerDownloadState = {
  ip: string;
  port: number;
  peerId?: string;
  choked: boolean;
  piecesAvailable: number;
  piecesAvailableKnown: boolean;
  downloadedBytes: number;
  pendingRequests: number;
  encryption: "unknown" | "plaintext" | "mse-rc4";
};
