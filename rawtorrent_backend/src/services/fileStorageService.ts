import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ResumableSessionRecord } from "../types/torrent";

export interface SessionStoragePaths {
  rootDir: string;
  sessionDir: string;
  piecesDir: string;
  finalFilePath: string;
  sourceFilePath: string;
  stateFilePath: string;
  metadataFilePath: string;
}

export interface SessionDownloadMetadata {
  sessionId: string;
  fileName: string;
  infoHash: string;
  pieceHashes: string[];
  pieceLength: number;
  totalLength: number;
  createdAt: number;
}

const sanitizeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const getDefaultStorageRootDir = () => {
  if (process.platform === "win32") {
    const systemDrive = String(process.env.SystemDrive ?? "C:").trim() || "C:";
    return path.join(systemDrive, "rawtorrent-data");
  }

  return path.join(os.homedir(), "rawtorrent-data");
};

export const getStorageRootDir = () => {
  const configured = process.env.TORRENT_STORAGE_DIR?.trim();

  // Keep torrent payloads out of user-profile folders by default for steadier 24/7 writes.
  return configured && configured.length > 0 ? configured : getDefaultStorageRootDir();
};

export const getSessionStoragePaths = (sessionId: string, fileName = "download.bin"): SessionStoragePaths => {
  const rootDir = getStorageRootDir();
  const sessionDir = path.join(rootDir, sessionId);
  const piecesDir = path.join(sessionDir, "pieces");
  const safeName = sanitizeFileName(fileName);

  return {
    rootDir,
    sessionDir,
    piecesDir,
    finalFilePath: path.join(sessionDir, safeName),
    sourceFilePath: path.join(sessionDir, "source.torrent"),
    stateFilePath: path.join(sessionDir, "state.json"),
    metadataFilePath: path.join(sessionDir, "metadata.json"),
  };
};

const resumableSessionsFilePath = () => path.join(getStorageRootDir(), "resumable-sessions.json");

export const ensureSessionStorage = (paths: SessionStoragePaths) => {
  fs.mkdirSync(paths.rootDir, { recursive: true });
  fs.mkdirSync(paths.sessionDir, { recursive: true });
  fs.mkdirSync(paths.piecesDir, { recursive: true });
};

export const piecePath = (paths: SessionStoragePaths, index: number) =>
  path.join(paths.piecesDir, `piece_${index}.bin`);

export const writeJsonSafely = (filePath: string, value: unknown) => {
  const payload = JSON.stringify(value, null, 2);
  const attempts = Number(process.env.STATE_WRITE_RETRIES ?? 5);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    try {
      fs.writeFileSync(temporaryPath, payload);
      fs.renameSync(temporaryPath, filePath);
      return;
    } catch (error) {
      try {
        if (fs.existsSync(temporaryPath)) {
          fs.unlinkSync(temporaryPath);
        }
      } catch {
        // Ignore cleanup errors.
      }

      const isLastAttempt = attempt === attempts;
      if (isLastAttempt) {
        // Fallback to direct write when atomic rename is locked by OS/AV.
        fs.writeFileSync(filePath, payload);
        return;
      }

      // Small backoff to let filesystem locks clear.
      const waitMs = attempt * 20;
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        // Busy wait in sync path by design (short and bounded).
      }
    }
  }
};

const normalizeResumableStatus = (value: unknown): ResumableSessionRecord["status"] | null => {
  if (value === "starting") return "starting";
  if (value === "running") return "running";
  if (value === "paused") return "paused";
  return null;
};

const normalizeSelectedFileIndices = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      value
        .map((candidate) => Number(candidate))
        .filter((candidate) => Number.isInteger(candidate) && candidate >= 0)
    )
  );

  return normalized.length > 0 ? normalized : undefined;
};

const normalizeResumableRecord = (value: unknown): ResumableSessionRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as {
    sessionId?: unknown;
    userId?: unknown;
    fileName?: unknown;
    sourceType?: unknown;
    magnetUri?: unknown;
    torrentFilePath?: unknown;
    selectedFileIndices?: unknown;
    status?: unknown;
    seeding?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };

  if (typeof raw.sessionId !== "string" || raw.sessionId.trim().length === 0) {
    return null;
  }

  const status = normalizeResumableStatus(raw.status);
  if (!status) {
    return null;
  }

  const sourceType = raw.sourceType === "magnet" ? "magnet" : raw.sourceType === "torrent-file" ? "torrent-file" : null;
  if (!sourceType) {
    return null;
  }

  const fileName = typeof raw.fileName === "string" && raw.fileName.trim().length > 0 ? raw.fileName : raw.sessionId;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;

  const normalized: ResumableSessionRecord = {
    sessionId: raw.sessionId,
    userId: typeof raw.userId === "string" && raw.userId.trim().length > 0 ? raw.userId : undefined,
    fileName,
    sourceType,
    magnetUri: typeof raw.magnetUri === "string" && raw.magnetUri.trim().length > 0 ? raw.magnetUri : undefined,
    torrentFilePath:
      typeof raw.torrentFilePath === "string" && raw.torrentFilePath.trim().length > 0
        ? raw.torrentFilePath
        : undefined,
    selectedFileIndices: normalizeSelectedFileIndices(raw.selectedFileIndices),
    status,
    seeding: raw.seeding === true,
    createdAt,
    updatedAt,
  };

  if (normalized.sourceType === "magnet" && !normalized.magnetUri) {
    return null;
  }

  if (normalized.sourceType === "torrent-file" && !normalized.torrentFilePath) {
    return null;
  }

  return normalized;
};

const readResumableSessionsUnsafe = (): ResumableSessionRecord[] => {
  const indexPath = resumableSessionsFilePath();
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((record) => normalizeResumableRecord(record))
      .filter((record): record is ResumableSessionRecord => record !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

const writeResumableSessionsUnsafe = (records: ResumableSessionRecord[]) => {
  const indexPath = resumableSessionsFilePath();
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  writeJsonSafely(
    indexPath,
    records.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  );
};

export const listResumableSessions = (): ResumableSessionRecord[] => readResumableSessionsUnsafe();

export const upsertResumableSession = (record: ResumableSessionRecord) => {
  const normalized = normalizeResumableRecord(record);
  if (!normalized) {
    return;
  }

  const current = readResumableSessionsUnsafe();
  const byId = new Map(current.map((entry) => [entry.sessionId, entry]));
  byId.set(normalized.sessionId, normalized);

  writeResumableSessionsUnsafe(Array.from(byId.values()));
};

export const removeResumableSession = (sessionId: string) => {
  const current = readResumableSessionsUnsafe();
  const next = current.filter((record) => record.sessionId !== sessionId);

  if (next.length === current.length) {
    return;
  }

  writeResumableSessionsUnsafe(next);
};

export const persistSessionSourceTorrent = (sessionId: string, fileName: string, source: Buffer): string => {
  const paths = getSessionStoragePaths(sessionId, fileName);
  ensureSessionStorage(paths);
  fs.writeFileSync(paths.sourceFilePath, source);
  return paths.sourceFilePath;
};

export const loadSessionSourceTorrent = (sourceFilePath: string): Buffer | null => {
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    return null;
  }

  try {
    return fs.readFileSync(sourceFilePath);
  } catch {
    return null;
  }
};

export const deleteSessionStorage = (sessionId: string): boolean => {
  const paths = getSessionStoragePaths(sessionId);
  if (!fs.existsSync(paths.sessionDir)) {
    return false;
  }

  try {
    fs.rmSync(paths.sessionDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

export const writeDownloadMetadata = (paths: SessionStoragePaths, metadata: SessionDownloadMetadata) => {
  writeJsonSafely(paths.metadataFilePath, metadata);
};

export const readDownloadMetadata = (metadataFilePath: string): SessionDownloadMetadata | null => {
  if (!fs.existsSync(metadataFilePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(metadataFilePath, "utf8")) as SessionDownloadMetadata;
  } catch {
    return null;
  }
};

export const persistSessionState = (
  paths: SessionStoragePaths,
  state: { completedPieces: number[]; downloadedBytes: number }
) => {
  writeJsonSafely(paths.stateFilePath, state);
};

export const loadSessionState = (
  paths: SessionStoragePaths
): { completedPieces: number[]; downloadedBytes: number } | null => {
  if (!fs.existsSync(paths.stateFilePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(paths.stateFilePath, "utf8")) as {
      completedPieces?: unknown;
      downloadedBytes?: unknown;
    };

    const completedPieces = Array.isArray(parsed.completedPieces)
      ? parsed.completedPieces.filter((value): value is number => Number.isInteger(value))
      : [];

    const downloadedBytes = Number(parsed.downloadedBytes ?? 0);

    return {
      completedPieces,
      downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : 0,
    };
  } catch {
    return null;
  }
};
