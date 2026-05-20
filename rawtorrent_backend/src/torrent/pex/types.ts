export interface PexPeer {
  ip: string;
  port: number;
}

export interface PexState {
  peerExtensionId: number | null;
  ourExtensionId: number;
  supportsExtensions: boolean;
  knownPeers: Set<string>;
  lastPexTime: number;
}
