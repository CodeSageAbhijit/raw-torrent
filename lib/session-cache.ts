export type SessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "stopped";

export type SessionPeer = {
  ip: string;
  port: number;
  peerId?: string;
};

export type SessionCacheRecord = {
  sessionId: string;
  fileName: string;
  status: SessionStatus;
  progress: number;
  peers: SessionPeer[];
  updatedAt: number;
};

export type SessionCacheInput = {
  sessionId: string;
  fileName?: string;
  status?: SessionStatus;
  progress?: number;
  peers?: SessionPeer[];
  updatedAt?: number;
};

const STORAGE_KEY = "rawtorrent:session-cache:v1";
const MAX_RECORDS = 80;
const MAX_PEERS_PER_RECORD = 160;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const toSessionStatus = (value: unknown): SessionStatus => {
  if (value === "idle") return "idle";
  if (value === "starting") return "starting";
  if (value === "running") return "running";
  if (value === "paused") return "paused";
  if (value === "completed") return "completed";
  if (value === "error") return "error";
  if (value === "stopped") return "stopped";
  return "starting";
};

const toProgress = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(1))));
};

const toPeers = (value: unknown): SessionPeer[] => {
  if (!Array.isArray(value)) return [];

  const peers: SessionPeer[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;

    const record = candidate as { ip?: unknown; port?: unknown; peerId?: unknown };
    if (typeof record.ip !== "string" || record.ip.length === 0) continue;

    const port = typeof record.port === "number" ? record.port : Number(record.port ?? 0);
    if (!Number.isFinite(port) || port <= 0) continue;

    peers.push({
      ip: record.ip,
      port,
      peerId: typeof record.peerId === "string" ? record.peerId : undefined,
    });

    if (peers.length >= MAX_PEERS_PER_RECORD) {
      break;
    }
  }

  return peers;
};

const keepRecord = (record: SessionCacheRecord, now: number) => {
  if (record.status === "running" || record.status === "starting" || record.status === "paused") {
    return true;
  }

  return now - record.updatedAt <= CACHE_TTL_MS;
};

const sortByFreshness = (records: SessionCacheRecord[]) =>
  records.slice().sort((a, b) => b.updatedAt - a.updatedAt);

const readRawRecords = (): SessionCacheRecord[] => {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();
    const sanitized: SessionCacheRecord[] = [];
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== "object") continue;

      const record = candidate as {
        sessionId?: unknown;
        fileName?: unknown;
        status?: unknown;
        progress?: unknown;
        peers?: unknown;
        updatedAt?: unknown;
      };

      if (typeof record.sessionId !== "string" || record.sessionId.length === 0) continue;

      const updatedAt =
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : now;

      const normalized: SessionCacheRecord = {
        sessionId: record.sessionId,
        fileName: typeof record.fileName === "string" && record.fileName.length > 0 ? record.fileName : record.sessionId,
        status: toSessionStatus(record.status),
        progress: toProgress(record.progress),
        peers: toPeers(record.peers),
        updatedAt,
      };

      if (keepRecord(normalized, now)) {
        sanitized.push(normalized);
      }
    }

    return sortByFreshness(sanitized).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
};

const writeRawRecords = (records: SessionCacheRecord[]) => {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortByFreshness(records).slice(0, MAX_RECORDS)));
  } catch {
    // Ignore storage quota/serialization errors
  }
};

export const loadCachedSessions = (): SessionCacheRecord[] => {
  const records = readRawRecords();
  writeRawRecords(records);
  return records;
};

export const upsertCachedSessions = (sessions: SessionCacheInput[]): SessionCacheRecord[] => {
  const existing = readRawRecords();
  if (!isBrowser()) {
    return existing;
  }

  const now = Date.now();
  const byId = new Map(existing.map((record) => [record.sessionId, record]));

  for (const session of sessions) {
    if (!session || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
      continue;
    }

    const previous = byId.get(session.sessionId);
    const merged: SessionCacheRecord = {
      sessionId: session.sessionId,
      fileName:
        typeof session.fileName === "string" && session.fileName.length > 0
          ? session.fileName
          : (previous?.fileName ?? session.sessionId),
      status: toSessionStatus(session.status ?? previous?.status ?? "starting"),
      progress: toProgress(session.progress ?? previous?.progress ?? 0),
      peers: toPeers(session.peers ?? previous?.peers ?? []),
      updatedAt:
        typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
          ? session.updatedAt
          : now,
    };

    if (keepRecord(merged, now)) {
      byId.set(merged.sessionId, merged);
    } else {
      byId.delete(merged.sessionId);
    }
  }

  const merged = sortByFreshness(Array.from(byId.values())).slice(0, MAX_RECORDS);
  writeRawRecords(merged);
  return merged;
};

export const upsertCachedSession = (session: SessionCacheInput): SessionCacheRecord[] =>
  upsertCachedSessions([session]);

export const removeCachedSession = (sessionId: string): SessionCacheRecord[] => {
  const existing = readRawRecords();
  if (!isBrowser()) {
    return existing;
  }

  const filtered = existing.filter((record) => record.sessionId !== sessionId);
  writeRawRecords(filtered);
  return filtered;
};
