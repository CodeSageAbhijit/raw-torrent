// Shared runtime settings for the entire application
// This is used by both the API and torrent service for consistency

export interface RuntimeSettings {
  port: number;
  maxPeers: number;
  downloadLimit: number;
  uploadLimit: number;
  maxRequestsPerPeer: number;
  requestTimeoutMs: number;
  trackerAnnounceInterval: number;
  trackerNumwant: number;
  autoPickBestPeers: boolean;
  enablePEX: boolean;
  enableDHT: boolean;
  pieceSelectionStrategy: "sequential" | "random" | "rarest-first";
  peerConnectionTimeoutMs: number;
  turboMode: boolean;
  adaptiveTuning: boolean;
  extraTrackers: string[];
}

// Default settings - optimized for good speed and stability
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  port: 6881,
  maxPeers: 120,
  downloadLimit: 12288, // 12 MB/s default ceiling for SSD safety
  uploadLimit: 1024, // 1 MB/s cap helps keep downloads stable over long runs
  maxRequestsPerPeer: 20,
  requestTimeoutMs: 20000,
  trackerAnnounceInterval: 45,
  trackerNumwant: 350,
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: true,
  pieceSelectionStrategy: "rarest-first",
  peerConnectionTimeoutMs: 12000,
  turboMode: true,
  adaptiveTuning: true,
  extraTrackers: [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "https://tracker.opentrackr.org:443/announce",
  ],
};

// Global runtime settings stored in memory
let globalSettings: RuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };

export function getGlobalSettings(): RuntimeSettings {
  return globalSettings;
}

export function setGlobalSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  const merged = {
    ...globalSettings,
    ...settings,
  };

  globalSettings = merged;
  return globalSettings;
}

export function resetSettings(): RuntimeSettings {
  globalSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  return globalSettings;
}
