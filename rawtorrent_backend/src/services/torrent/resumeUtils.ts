import type { ResumableSessionRecord, StartTorrentOptions, TorrentSessionState } from "../../types/torrent";
import {
  getSessionStoragePaths,
  loadSessionSourceTorrent,
  removeResumableSession,
  upsertResumableSession,
} from "../fileStorageService";
import { logger } from "../../utils/logger";
import {
  ensurePersistentSourceForManagedSession,
  normalizeSelectedFileIndices,
  normalizeTorrentPathForRecord,
  resolveTorrentPathFromRecord,
  type ManagedSessionSourceInfo,
} from "./sourceUtils";

type ManagedSessionResumableInfo = ManagedSessionSourceInfo & {
  session: TorrentSessionState;
};

export const isResumableStatus = (
  status: TorrentSessionState["status"]
): status is "starting" | "running" | "paused" | "completed" =>
  status === "starting" || status === "running" || status === "paused" || status === "completed";

export const syncResumableSessionRecord = (managedSession: ManagedSessionResumableInfo) => {
  if (!isResumableStatus(managedSession.session.status)) {
    removeResumableSession(managedSession.session.sessionId);
    return;
  }

  let magnetUri: string | undefined;
  let torrentFilePath: string | undefined;

  if (managedSession.sourceType === "magnet") {
    magnetUri = typeof managedSession.source === "string" ? managedSession.source : undefined;
  } else {
    torrentFilePath = ensurePersistentSourceForManagedSession(managedSession);
  }

  if (managedSession.sourceType === "magnet" && !magnetUri) {
    logger.warn(`[AutoResume] Skipping resume persistence for ${managedSession.session.sessionId}: missing magnet URI`);
    return;
  }

  if (managedSession.sourceType === "torrent-file" && !torrentFilePath) {
    logger.warn(
      `[AutoResume] Skipping resume persistence for ${managedSession.session.sessionId}: missing source torrent file`
    );
    return;
  }

  const record: ResumableSessionRecord = {
    sessionId: managedSession.session.sessionId,
    userId: managedSession.session.userId,
    fileName: managedSession.session.fileName,
    sourceType: managedSession.sourceType,
    magnetUri,
    torrentFilePath: normalizeTorrentPathForRecord(torrentFilePath),
    selectedFileIndices: normalizeSelectedFileIndices(managedSession.selectedFileIndices),
    savePath: managedSession.savePath,
    status: managedSession.session.status,
    seeding: managedSession.session.seeding,
    createdAt: managedSession.session.createdAt,
    updatedAt: Date.now(),
  };

  upsertResumableSession(record);
};

export const buildRestoreSourceOptions = (
  record: ResumableSessionRecord
): Pick<StartTorrentOptions, "magnetUri" | "input"> | null => {
  if (record.sourceType === "magnet") {
    if (!record.magnetUri) {
      return null;
    }

    return {
      magnetUri: record.magnetUri,
    };
  }

  const resolvedTorrentPath = resolveTorrentPathFromRecord(record);
  const fallbackSourcePath = getSessionStoragePaths(record.sessionId, record.fileName, record.savePath).sourceFilePath;

  const sourceBuffer = resolvedTorrentPath ? loadSessionSourceTorrent(resolvedTorrentPath) : null;
  const fallbackBuffer = sourceBuffer ? null : loadSessionSourceTorrent(fallbackSourcePath);
  const restoreBuffer = sourceBuffer ?? fallbackBuffer;

  if (!restoreBuffer) {
    return null;
  }

  return {
    input: restoreBuffer,
  };
};
