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
  extraTrackers: string[];
}

// Default settings - optimized for good speed and stability
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  port: 6881,
  maxPeers: 250,
  downloadLimit: 0, // Unlimited
  uploadLimit: 0, // Unlimited
  maxRequestsPerPeer: 10,
  requestTimeoutMs: 30000,
  trackerAnnounceInterval: 60,
  trackerNumwant: 500,
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: true,
  pieceSelectionStrategy: "rarest-first",
  peerConnectionTimeoutMs: 15000,
  extraTrackers: [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://9.rarbg.to:2710/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.publicbt.com:80/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "https://tracker.opentrackr.org:443/announce",
    "udp://tracker.1337x.com:6969/announce",
    "udp://tracker.zer0day.to:1337/announce",
  ],
};

// Global runtime settings stored in memory
let globalSettings: RuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };

export function getGlobalSettings(): RuntimeSettings {
  return globalSettings;
}

export function setGlobalSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  globalSettings = { ...globalSettings, ...settings };
  return globalSettings;
}

export function resetSettings(): RuntimeSettings {
  globalSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  return globalSettings;
}
