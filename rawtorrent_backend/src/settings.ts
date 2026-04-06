// Shared runtime settings for the entire application
// This is used by both the API and torrent service for consistency

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const getDefaultStorageRootDir = () => {
  if (process.platform === "win32") {
    const systemDrive = String(process.env.SystemDrive ?? "C:").trim() || "C:";
    return path.join(systemDrive, "rawtorrent-data");
  }

  return path.join(os.homedir(), "rawtorrent-data");
};

const getStorageRootDir = () => {
  const configured = process.env.TORRENT_STORAGE_DIR?.trim();
  return configured && configured.length > 0 ? configured : getDefaultStorageRootDir();
};

const getSettingsFilePath = () => path.join(getStorageRootDir(), "runtime-settings.json");

const loadSettingsFromDisk = (): Partial<RuntimeSettings> => {
  const filePath = getSettingsFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<RuntimeSettings>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
};

const persistSettingsToDisk = (settings: RuntimeSettings) => {
  try {
    const filePath = getSettingsFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  } catch {
    // Ignore persistence write failures; in-memory settings still apply.
  }
};

// Global runtime settings stored in memory
let globalSettings: RuntimeSettings = {
  ...DEFAULT_RUNTIME_SETTINGS,
  ...loadSettingsFromDisk(),
};

if (!Array.isArray(globalSettings.extraTrackers)) {
  globalSettings.extraTrackers = [...DEFAULT_RUNTIME_SETTINGS.extraTrackers];
}

if (!globalSettings.pieceSelectionStrategy || !["sequential", "random", "rarest-first"].includes(globalSettings.pieceSelectionStrategy)) {
  globalSettings.pieceSelectionStrategy = DEFAULT_RUNTIME_SETTINGS.pieceSelectionStrategy;
}

export function getGlobalSettings(): RuntimeSettings {
  return globalSettings;
}

export function setGlobalSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  const merged = {
    ...globalSettings,
    ...settings,
  };

  globalSettings = merged as RuntimeSettings;
  persistSettingsToDisk(globalSettings);
  return globalSettings;
}

export function resetSettings(): RuntimeSettings {
  globalSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  persistSettingsToDisk(globalSettings);
  return globalSettings;
}
