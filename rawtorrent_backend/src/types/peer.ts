export type PeerEncryption = "plaintext" | "rc4" | "mse";

export interface PeerAddress {
  ip: string;
  port: number;
}

export interface PeerDescriptor extends PeerAddress {
  peerId?: string;
  client?: string;
  encryption?: PeerEncryption;
}

export interface PeerRuntimeState extends PeerDescriptor {
  connected: boolean;
  choked: boolean;
  interested: boolean;
  downloadedBytes: number;
  uploadedBytes: number;
  lastSeenAt: number;
}

export interface PeerMessageFrame {
  length: number;
  id: number | null;
  payload: Buffer;
}
