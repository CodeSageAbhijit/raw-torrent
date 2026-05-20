import fs from "node:fs";
import bencode from "bencode";
import { getGlobalSettings } from "../../settings";

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.opentrackr.org:443/announce",
];

const SUPPORTED_TRACKER_PROTOCOLS = new Set(["udp:", "http:", "https:", "ws:", "wss:"]);

type SourceType = "magnet" | "torrent-file";

type TrackerRecord = Record<string, unknown>;

const normalizeTrackerUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!SUPPORTED_TRACKER_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
};

const decodeBencodedString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return "";
};

const dedupeTrackers = (trackers: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const tracker of trackers) {
    const normalized = normalizeTrackerUrl(tracker);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
};

export const extractTrackersFromSource = (source: string | Buffer, sourceType: SourceType): string[] => {
  try {
    if (sourceType === "magnet" && typeof source === "string") {
      const sourceText = source.trim();
      if (!sourceText.startsWith("magnet:?")) {
        return [];
      }

      const url = new URL(sourceText);
      return dedupeTrackers(url.searchParams.getAll("tr"));
    }

    let torrentBuffer: Buffer | null = null;

    if (Buffer.isBuffer(source)) {
      torrentBuffer = source;
    } else if (typeof source === "string" && fs.existsSync(source)) {
      torrentBuffer = fs.readFileSync(source);
    }

    if (!torrentBuffer || torrentBuffer.length === 0) {
      return [];
    }

    const decoded = bencode.decode(torrentBuffer) as TrackerRecord;
    const announce = decodeBencodedString(decoded.announce);
    const announceListRaw = Array.isArray(decoded["announce-list"])
      ? (decoded["announce-list"] as unknown[])
      : [];

    const announceList = announceListRaw
      .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
      .map((entry) => decodeBencodedString(entry))
      .filter((entry) => entry.trim().length > 0);

    return dedupeTrackers([announce, ...announceList]);
  } catch {
    return [];
  }
};

export const getTrackerPool = (sourceTrackers: string[] = []) => {
  const settings = getGlobalSettings();
  return dedupeTrackers([...sourceTrackers, ...settings.extraTrackers, ...DEFAULT_TRACKERS]);
};
