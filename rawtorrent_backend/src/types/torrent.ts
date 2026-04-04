export type TorrentEventType =
  | "server_started"
  | "torrent_started"
  | "torrent_progress"
  | "torrent_completed"
  | "torrent_error"
  | "torrent_paused"
  | "torrent_resumed"
  | "torrent_stopped"
  | "tracker_announce"
  | "peer_discovered"
  | "peer_connected"
  | "peer_error"
  | "peer_unchoked"
  | "peer_choked"
  | "peer_bitfield"
  | "piece_requested"
  | "piece_verified"
  | "piece_failed"
  | "block_requested"
  | "block_received"
  | "download_progress"
  | "download_started"
  | "download_complete"
  | "log";

export interface TorrentEvent<TData = Record<string, unknown>> {
  type: TorrentEventType | string;
  data: TData;
  timestamp: number;
  sessionId?: string;
  source?: string;
}

export interface ParsedTorrentFile {
  fileName: string;
  sourceType: "torrent-file" | "magnet";
  trackerUrl: string;
  trackerUrls: string[];
  infoHash: string;
  pieceLength: number;
  pieceHashes: string[];
  totalLength: number;
  announceList: string[];
}

export interface TrackerPeerDescriptor {
  ip: string;
  port: number;
  peerId?: string;
}

export interface TorrentSessionState {
  sessionId: string;
  fileName: string;
  infoHash: string;
  trackerUrl: string;
  peerId: string;
  peers: TrackerPeerDescriptor[];
  pieceCount: number;
  completedPieces: number[];
  progress: number;
  status: "idle" | "starting" | "running" | "paused" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  userId?: string;
}

export interface StartTorrentOptions {
  input?: string | Buffer | Uint8Array | ArrayBuffer;
  magnetUri?: string;
  fileName?: string;
  sessionId?: string;
  userId?: string;
}
