import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SessionStoragePaths {
  rootDir: string;
  sessionDir: string;
  piecesDir: string;
  finalFilePath: string;
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

export const getStorageRootDir = () => {
  const configured = process.env.TORRENT_STORAGE_DIR?.trim();
  
  // Automatically fallback to the user's native "Downloads/Torrents" folder across any OS 
  // (Windows, macOS, Linux, etc) instead of hardcoding a path.
  const nativeDownloadsDir = path.join(os.homedir(), "Downloads", "rawtorrent");

  return configured && configured.length > 0
    ? configured
    : nativeDownloadsDir;
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
    stateFilePath: path.join(sessionDir, "state.json"),
    metadataFilePath: path.join(sessionDir, "metadata.json"),
  };
};

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
