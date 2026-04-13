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

type DeviceProfile = "low" | "balanced" | "high";

const pickDeviceProfile = (): DeviceProfile => {
  const totalMemGiB = os.totalmem() / (1024 ** 3);
  const cpuCores = os.cpus().length;

  if (totalMemGiB <= 8 || cpuCores <= 4) {
    return "low";
  }

  if (totalMemGiB <= 16 || cpuCores <= 8) {
    return "balanced";
  }

  return "high";
};

const buildAutoDefaults = (): RuntimeSettings => {
  const profile = pickDeviceProfile();

  const profileSettings: Record<DeviceProfile, Pick<RuntimeSettings, "maxPeers" | "downloadLimit" | "maxRequestsPerPeer" | "trackerNumwant">> = {
    low: {
      maxPeers: 32,
      downloadLimit: 2048,
      maxRequestsPerPeer: 6,
      trackerNumwant: 120,
    },
    balanced: {
      maxPeers: 48,
      downloadLimit: 4096,
      maxRequestsPerPeer: 8,
      trackerNumwant: 180,
    },
    high: {
      maxPeers: 64,
      downloadLimit: 6144,
      maxRequestsPerPeer: 10,
      trackerNumwant: 240,
    },
  };

  return {
    port: 6881,
    maxPeers: profileSettings[profile].maxPeers,
    downloadLimit: profileSettings[profile].downloadLimit,
    uploadLimit: 1024,
    maxRequestsPerPeer: profileSettings[profile].maxRequestsPerPeer,
    requestTimeoutMs: 20000,
    trackerAnnounceInterval: 45,
    trackerNumwant: profileSettings[profile].trackerNumwant,
    autoPickBestPeers: true,
    enablePEX: true,
    enableDHT: true,
    pieceSelectionStrategy: "rarest-first",
    peerConnectionTimeoutMs: 12000,
    turboMode: false,
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
};

// Default settings are auto-profiled from local CPU/RAM once on service boot.
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = buildAutoDefaults();

const getDefaultStorageRootDir = () => {
  return path.join(os.homedir(), "Downloads", "RawTorrent");
};

const getStorageRootDir = () => {
  return getDefaultStorageRootDir();
};

const getSettingsFilePath = () => path.join(getStorageRootDir(), "runtime-settings.json");

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const normalizeRuntimeSettings = (settings: Partial<RuntimeSettings>): RuntimeSettings => {
  const merged = {
    ...DEFAULT_RUNTIME_SETTINGS,
    ...settings,
  };

  return {
    ...merged,
    port: clampInt(merged.port, DEFAULT_RUNTIME_SETTINGS.port, 1024, 65535),
    maxPeers: clampInt(merged.maxPeers, DEFAULT_RUNTIME_SETTINGS.maxPeers, 16, 96),
    downloadLimit: clampInt(merged.downloadLimit, DEFAULT_RUNTIME_SETTINGS.downloadLimit, 512, 6144),
    uploadLimit: clampInt(merged.uploadLimit, DEFAULT_RUNTIME_SETTINGS.uploadLimit, 128, 4096),
    maxRequestsPerPeer: clampInt(merged.maxRequestsPerPeer, DEFAULT_RUNTIME_SETTINGS.maxRequestsPerPeer, 4, 12),
    requestTimeoutMs: clampInt(merged.requestTimeoutMs, DEFAULT_RUNTIME_SETTINGS.requestTimeoutMs, 5000, 60000),
    trackerAnnounceInterval: clampInt(merged.trackerAnnounceInterval, DEFAULT_RUNTIME_SETTINGS.trackerAnnounceInterval, 15, 300),
    trackerNumwant: clampInt(merged.trackerNumwant, DEFAULT_RUNTIME_SETTINGS.trackerNumwant, 50, 300),
    peerConnectionTimeoutMs: clampInt(
      merged.peerConnectionTimeoutMs,
      DEFAULT_RUNTIME_SETTINGS.peerConnectionTimeoutMs,
      5000,
      30000
    ),
    enablePEX: merged.enablePEX !== false,
    enableDHT: merged.enableDHT !== false,
    autoPickBestPeers: merged.autoPickBestPeers !== false,
    turboMode: merged.turboMode === true,
    adaptiveTuning: merged.adaptiveTuning !== false,
    pieceSelectionStrategy:
      merged.pieceSelectionStrategy === "sequential" ||
      merged.pieceSelectionStrategy === "random" ||
      merged.pieceSelectionStrategy === "rarest-first"
        ? merged.pieceSelectionStrategy
        : DEFAULT_RUNTIME_SETTINGS.pieceSelectionStrategy,
    extraTrackers: Array.isArray(merged.extraTrackers)
      ? merged.extraTrackers.filter((tracker) => typeof tracker === "string" && tracker.trim().length > 0)
      : [...DEFAULT_RUNTIME_SETTINGS.extraTrackers],
  };
};

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
let globalSettings: RuntimeSettings = normalizeRuntimeSettings(loadSettingsFromDisk());

export function getGlobalSettings(): RuntimeSettings {
  return globalSettings;
}

export function setGlobalSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  globalSettings = normalizeRuntimeSettings({
    ...globalSettings,
    ...settings,
  });
  persistSettingsToDisk(globalSettings);
  return globalSettings;
}

export function resetSettings(): RuntimeSettings {
  globalSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  persistSettingsToDisk(globalSettings);
  return globalSettings;
}
