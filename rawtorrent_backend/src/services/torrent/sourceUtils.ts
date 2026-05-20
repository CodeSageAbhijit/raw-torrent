import fs from "node:fs";
import path from "node:path";
import type { ResumableSessionRecord, StartTorrentOptions, TorrentSessionState } from "../../types/torrent";
import { getStorageRootDir, persistSessionSourceTorrent } from "../fileStorageService";

export type ManagedSessionSourceInfo = {
  sourceType: "magnet" | "torrent-file";
  source: string | Buffer;
  sourceTorrentFilePath?: string;
  session: Pick<TorrentSessionState, "sessionId" | "fileName">;
  savePath?: string;
  selectedFileIndices?: number[];
};

export const getSourceAndType = (
  options: StartTorrentOptions
): { source: string | Buffer; sourceType: "magnet" | "torrent-file" } => {
  if (options.magnetUri && options.magnetUri.trim().length > 0) {
    return { source: options.magnetUri.trim(), sourceType: "magnet" };
  }

  if (!options.input) {
    throw new Error("Provide magnetUri or a torrent file");
  }

  if (Buffer.isBuffer(options.input)) {
    return { source: options.input, sourceType: "torrent-file" };
  }

  if (options.input instanceof Uint8Array) {
    return { source: Buffer.from(options.input), sourceType: "torrent-file" };
  }

  if (options.input instanceof ArrayBuffer) {
    return { source: Buffer.from(options.input), sourceType: "torrent-file" };
  }

  if (typeof options.input === "string") {
    return { source: options.input, sourceType: "torrent-file" };
  }

  throw new Error("Unsupported torrent input type");
};

export const normalizeSelectedFileIndices = (indices?: number[]) => {
  if (!Array.isArray(indices)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      indices
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    )
  );

  return normalized.length > 0 ? normalized : undefined;
};

export const ensurePersistentSourceForManagedSession = (managedSession: ManagedSessionSourceInfo): string | undefined => {
  if (managedSession.sourceType !== "torrent-file") {
    return undefined;
  }

  if (managedSession.sourceTorrentFilePath && fs.existsSync(managedSession.sourceTorrentFilePath)) {
    return managedSession.sourceTorrentFilePath;
  }

  if (typeof managedSession.source === "string") {
    if (fs.existsSync(managedSession.source)) {
      managedSession.sourceTorrentFilePath = managedSession.source;
      return managedSession.source;
    }
    return undefined;
  }

  const sourceBuffer = Buffer.isBuffer(managedSession.source)
    ? managedSession.source
    : Buffer.from(managedSession.source);

  managedSession.sourceTorrentFilePath = persistSessionSourceTorrent(
    managedSession.session.sessionId,
    managedSession.session.fileName,
    sourceBuffer
  );

  return managedSession.sourceTorrentFilePath;
};

export const normalizeTorrentPathForRecord = (torrentFilePath: string | undefined): string | undefined => {
  if (!torrentFilePath) {
    return undefined;
  }

  const rootDir = getStorageRootDir();
  const relative = path.relative(rootDir, torrentFilePath);
  const isInsideStorageRoot = relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);

  if (!isInsideStorageRoot) {
    return torrentFilePath;
  }

  return relative.split(path.sep).join("/");
};

export const resolveTorrentPathFromRecord = (record: ResumableSessionRecord): string | null => {
  const raw = typeof record.torrentFilePath === "string" ? record.torrentFilePath.trim() : "";
  if (!raw) {
    return null;
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.join(getStorageRootDir(), raw);
};
