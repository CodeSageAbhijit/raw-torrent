import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebTorrent from "webtorrent";
import type {
  ResumableSessionRecord,
  StartTorrentOptions,
  TorrentFileInfo,
  TorrentSessionState,
} from "../types/torrent";
import { publishEvent } from "../events/eventBus";
import {
  appendSessionEvent,
  deleteSessionPersistence,
  listSessionsByUser,
  loadSession,
  persistSession,
} from "./persistenceService";
import {
  deleteSessionStorage,
  ensureSessionStorage,
  getSessionStoragePaths,
  listResumableSessions,
  removeResumableSession,
  writeDownloadMetadata,
} from "./fileStorageService";
import { getGlobalSettings } from "../settings";
import { logger } from "../utils/logger";
import { createPieceStore, stitchPieceFiles } from "./pieceFileStore";
import {
  computeProgress,
  extractTrackersFromSource,
  getPeerLabel,
  getPeersFromTorrent,
  getTrackerPool,
  parsePeerAddress,
  updatePeerStatesInPlace,
  updatePieceStatesInPlace,
  type DownloadProgress,
  type PeerDownloadState,
  type PieceState,
} from "./torrent";
import { decodeTorrentFiles } from "./torrent/fileDecoders";
import {
  buildRestoreSourceOptions,
  isResumableStatus,
  syncResumableSessionRecord,
} from "./torrent/resumeUtils";
import {
  ensurePersistentSourceForManagedSession,
  getSourceAndType,
  normalizeSelectedFileIndices,
} from "./torrent/sourceUtils";

type TorrentLike = any;


type WireTelemetry = {
  receivedBlocks: number;
  receivedBytes: number;
  receivedPeers: Set<string>;
  requestedBlocks: number;
};

type ManagedSession = {
  session: TorrentSessionState;
  torrent?: TorrentLike;
  source: string | Buffer;
  sourceType: "magnet" | "torrent-file";
  sourceTorrentFilePath?: string;
  selectedFileIndices?: number[];
  savePath?: string;
  pieceStates: PieceState[];
  peerStates: PeerDownloadState[];
  progress: DownloadProgress;
  latestFilePath: string | null;
  lastReannounceAt?: number;
  lastPeerStateRefreshAt?: number;
  lastPieceStateRefreshAt?: number;
  adaptiveMaxRequests: number;
  adaptiveStrategy: "sequential" | "random" | "rarest-first";
  lastAdaptiveTuneAt?: number;
  wireTelemetry: WireTelemetry;
  snapshotTimer?: NodeJS.Timeout;
};

const sessions = new Map<string, TorrentSessionState>();
const managed = new Map<string, ManagedSession>();
const pauseTeardownTasks = new Map<string, Promise<void>>();

const SEQUENTIAL_SELECTION_PRIORITY = 999;
const AUTO_RESUME_ON_BOOT = true;

const DEVICE_TOTAL_MEM_BYTES = os.totalmem();
const MEMORY_PRESSURE_HIGH_BYTES = Math.floor(Math.max(768 * 1024 * 1024, DEVICE_TOTAL_MEM_BYTES * 0.18));
const MEMORY_PRESSURE_CRITICAL_BYTES = Math.floor(Math.max(1024 * 1024 * 1024, DEVICE_TOTAL_MEM_BYTES * 0.24));
const MEMORY_PRESSURE_RECOVER_BYTES = Math.floor(MEMORY_PRESSURE_HIGH_BYTES * 0.72);
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};


const DISK_SAFETY_GUARD = {
  enabled: true,
  maxDownloadKb: DEVICE_TOTAL_MEM_BYTES <= 8 * 1024 * 1024 * 1024 ? 4096 : 6144,
  maxPeers: DEVICE_TOTAL_MEM_BYTES <= 8 * 1024 * 1024 * 1024 ? 48 : 72,
  maxRequestsPerPeer: DEVICE_TOTAL_MEM_BYTES <= 8 * 1024 * 1024 * 1024 ? 8 : 12,
};

const TURBO_ESSENTIAL_EVENTS = new Set([
  "server_started",
  "torrent_started",
  "download_progress",
  "torrent_completed",
  "torrent_error",
  "torrent_paused",
  "torrent_resumed",
  "torrent_stopped",
  "tracker_reannounce",
  "torrent_seeding_started",
  "torrent_seeding_stopped",
  "adaptive_tuning",
  "log",
]);

const WEBTORRENT_UTP_ENABLED = true;

export const torrentSessions = sessions;

const client = new WebTorrent({
  dht: true,
  tracker: true,
  utp: WEBTORRENT_UTP_ENABLED,
  maxConns: 300, // Global connection pool - individual torrents will respect their per-session limits via settings
  // Intentionally omit downloadLimit. In this WebTorrent version,
  // 0 is treated as a hard stop rather than "unlimited".
});

client.on("error", (err: Error) => {
  logger.error("[WebTorrent Engine Error] Fatal failure:", err.message, err.stack ?? "");
});


const shouldSuppressEventInTurbo = (eventType: string): boolean => {
  const settings = getGlobalSettings();
  if (!settings.turboMode) {
    return false;
  }

  return !TURBO_ESSENTIAL_EVENTS.has(eventType);
};

const emitEvent = async (event: {
  type: string;
  sessionId: string;
  data: Record<string, unknown>;
}) => {
  if (shouldSuppressEventInTurbo(event.type)) {
    return;
  }

  const payload = await publishEvent({
    ...event,
    timestamp: Date.now(),
  });

  await appendSessionEvent(payload);
};


const syncSession = async (session: TorrentSessionState) => {
  sessions.set(session.sessionId, session);
  await persistSession(session);

  const managedSession = managed.get(session.sessionId);
  if (managedSession) {
    syncResumableSessionRecord(managedSession);
  } else if (!isResumableStatus(session.status)) {
    removeResumableSession(session.sessionId);
  }
};


const getFilePathForDownload = (managedSession: ManagedSession, torrent: TorrentLike): string | null => {
  const sessionId = managedSession.session.sessionId;
  const files: any[] = Array.isArray(torrent?.files) ? torrent.files : [];
  if (files.length === 0) {
    return null;
  }

  const preferred = files.slice().sort((a, b) => (b.length ?? 0) - (a.length ?? 0))[0];
  const storage = getSessionStoragePaths(sessionId, preferred?.name ?? "download.bin", managedSession.savePath);

  if (preferred.path && path.isAbsolute(preferred.path)) {
    return preferred.path;
  }

  if (preferred.path) {
    return path.join(storage.sessionDir, preferred.path);
  }

  if (preferred.name) {
    return path.join(storage.sessionDir, preferred.name);
  }

  return null;
};


const flushWireTelemetry = async (managedSession: ManagedSession) => {
  const telemetry = managedSession.wireTelemetry;

  if (getGlobalSettings().turboMode) {
    telemetry.receivedBlocks = 0;
    telemetry.receivedBytes = 0;
    telemetry.receivedPeers.clear();
    telemetry.requestedBlocks = 0;
    return;
  }

  if (telemetry.receivedBlocks > 0) {
    const blocks = telemetry.receivedBlocks;
    const bytes = telemetry.receivedBytes;
    const peers = telemetry.receivedPeers.size;

    telemetry.receivedBlocks = 0;
    telemetry.receivedBytes = 0;
    telemetry.receivedPeers.clear();

    await emitEvent({
      type: "piece_batch_received",
      sessionId: managedSession.session.sessionId,
      data: {
        blocks,
        bytes,
        peers,
      },
    });
  }

  if (telemetry.requestedBlocks > 0) {
    telemetry.requestedBlocks = 0;
  }
};

const applyPieceSelectionStrategy = (
  torrent: TorrentLike,
  strategy: "sequential" | "random" | "rarest-first",
  windowSizePieces: number = 40 
) => {
  if (!torrent || typeof torrent.select !== "function") {
    return;
  }

  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  if (piecesTotal <= 0) {
    return;
  }

  let start = 0;
  let end = piecesTotal - 1;

  if (strategy !== "sequential") {
    // Remove only our explicit sequential override.
    if (typeof torrent.deselect === "function") {
      try {
        torrent.deselect(0, piecesTotal - 1, SEQUENTIAL_SELECTION_PRIORITY);
      } catch {
        // Ignore
      }
    }
    return;
  }

  // Dynamic Sliding Window for Sequential
  if (windowSizePieces > 0 && torrent?.bitfield?.get) {
    while (start < piecesTotal && torrent.bitfield.get(start)) {
      start++;
    }
    
    end = Math.min(start + windowSizePieces - 1, piecesTotal - 1);
    
    // Drop past pieces and future out-of-bounds pieces from the priority queue to cap RAM
    if (typeof torrent.deselect === "function") {
      try {
        if (start > 0) torrent.deselect(0, start - 1, SEQUENTIAL_SELECTION_PRIORITY);
        if (end < piecesTotal - 1) torrent.deselect(end + 1, piecesTotal - 1, SEQUENTIAL_SELECTION_PRIORITY);
      } catch { } // Ignore
    }
  }

  if (start <= end) {
    torrent.select(start, end, SEQUENTIAL_SELECTION_PRIORITY);
  }
};

const tuneAdaptiveWebTorrent = async (managedSession: ManagedSession) => {
  const settings = getGlobalSettings();
  if (!settings.adaptiveTuning || !managedSession.torrent) {
    return;
  }

  const now = Date.now();
  const tuneIntervalMs = settings.turboMode ? 4500 : 6000;
  if (now - (managedSession.lastAdaptiveTuneAt ?? 0) < tuneIntervalMs) {
    return;
  }

  managedSession.lastAdaptiveTuneAt = now;

  const speedMbps = managedSession.progress.downloadSpeed / (1024 * 1024);
  const peers = managedSession.progress.activePeers;
  const progress = managedSession.progress.progress;
  const rssBytes = process.memoryUsage().rss;
  const sparseSwarm = peers > 0 && peers < 20;
  const verySparseSwarm = peers > 0 && peers < 10;

  let targetMaxRequests = 20;
  if (speedMbps < 1.5) {
    targetMaxRequests = 56;
  } else if (speedMbps < 3) {
    targetMaxRequests = 44;
  } else if (speedMbps < 6) {
    targetMaxRequests = 32;
  } else if (speedMbps > 14) {
    targetMaxRequests = 18;
  }

  if (peers < 45) {
    targetMaxRequests += 6;
  }

  if (sparseSwarm) {
    targetMaxRequests = Math.max(targetMaxRequests, verySparseSwarm ? 62 : 54);
  }

  // Device-aware backpressure: reduce request fan-out under memory pressure.
  if (rssBytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
    targetMaxRequests = Math.min(targetMaxRequests, 6);
  } else if (rssBytes >= MEMORY_PRESSURE_HIGH_BYTES) {
    targetMaxRequests = Math.min(targetMaxRequests, 10);
  } else if (rssBytes < MEMORY_PRESSURE_RECOVER_BYTES) {
    targetMaxRequests += 1;
  }

  // Respect hard safety guard caps if enabled.
  const maxRequestsCap = DISK_SAFETY_GUARD.enabled ? DISK_SAFETY_GUARD.maxRequestsPerPeer : 64;
  targetMaxRequests = Math.max(4, Math.min(maxRequestsCap, targetMaxRequests));

  let targetStrategy: "sequential" | "random" | "rarest-first" =
    sparseSwarm || speedMbps < 1.5 || (progress < 20 && speedMbps < 4) ? "sequential" : "rarest-first";

  const baseMaxPeers = Number.isFinite(Number(settings.maxPeers)) ? Math.floor(Number(settings.maxPeers)) : 60;
  const normalPeerCap = Math.max(16, Math.min(DISK_SAFETY_GUARD.maxPeers, baseMaxPeers));
  let targetPeerCap = normalPeerCap;

  const baseDownloadLimitKb = Number.isFinite(Number(settings.downloadLimit))
    ? Math.floor(Number(settings.downloadLimit))
    : DISK_SAFETY_GUARD.maxDownloadKb;
  const normalDownloadCapKb = Math.max(1024, Math.min(DISK_SAFETY_GUARD.maxDownloadKb, baseDownloadLimitKb));
  let targetDownloadLimitKb = normalDownloadCapKb;

  if (rssBytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
    targetPeerCap = Math.min(targetPeerCap, 32); // Keep speeds somewhat viable
    targetDownloadLimitKb = Math.min(targetDownloadLimitKb, 4096);
    targetStrategy = "sequential";
  } else if (rssBytes >= MEMORY_PRESSURE_HIGH_BYTES) {
    targetPeerCap = Math.min(targetPeerCap, 60);
    targetStrategy = "sequential";
  } else {
    // For large torrents, default to sequential to keep RAM bounded
    if (Number(managedSession.torrent?.length ?? 0) > 4 * 1024 * 1024 * 1024) {
      targetStrategy = "sequential";
    }
  }

  const torrentRef = managedSession.torrent as any;
  const clientRef = client as any;
  let changed = false;

  if (managedSession.adaptiveMaxRequests !== targetMaxRequests) {
    managedSession.adaptiveMaxRequests = targetMaxRequests;
    torrentRef.maxRequests = targetMaxRequests;
    changed = true;
  }

  if (managedSession.adaptiveStrategy !== targetStrategy) {
    managedSession.adaptiveStrategy = targetStrategy;
    changed = true;
  }
  
  // Continuously apply sequential window if currently picking
  if (managedSession.adaptiveStrategy === "sequential") {
    // Calculate a dynamic window roughly based on memory footprint targets
    const pieceSize = Number(managedSession.torrent?.pieceLength || 1048576);
    // Base 640MB sliding window (40 x 16MB) normally, drops to 160MB under pressure
    const windowMB = rssBytes >= MEMORY_PRESSURE_CRITICAL_BYTES ? 80 : 
                     rssBytes >= MEMORY_PRESSURE_HIGH_BYTES ? 160 : 384; 
    const windowPieces = Math.max(10, Math.floor((windowMB * 1024 * 1024) / pieceSize));
    
    applyPieceSelectionStrategy(managedSession.torrent, targetStrategy, windowPieces);
  } else if (changed) {
    applyPieceSelectionStrategy(managedSession.torrent, targetStrategy);
  }

  if (Number(clientRef.maxConns ?? 0) !== targetPeerCap) {
    clientRef.maxConns = targetPeerCap;
    changed = true;
  }

  const targetDownloadLimitBytes = Math.floor(targetDownloadLimitKb * 1024);
  if (Number(clientRef.downloadLimit ?? 0) !== targetDownloadLimitBytes) {
    clientRef.downloadLimit = targetDownloadLimitBytes;
    changed = true;
  }

  // --- HARD-CLAMP DEAD PEERS (Graveyard Pruner) ---
  try {
    if (torrentRef.discovery && torrentRef.discovery._peers && typeof torrentRef.discovery._peers.size === "number") {
      if (torrentRef.discovery._peers.size > 150) {
        // It's a map/set: keep the first 150 and aggressively drop the rest from memory
        const keys = Array.from(torrentRef.discovery._peers.keys()).slice(150);
        keys.forEach((k: any) => torrentRef.discovery._peers.delete(k));
      }
    } else if (torrentRef.discovery && Array.isArray(torrentRef.discovery._peers) && torrentRef.discovery._peers.length > 150) {
      torrentRef.discovery._peers.length = 150; // Drop the tail from array
    }
  } catch (err) { /* ignore */ }

  // --- HARD-CLAMP GHOST UPLOADS (Seeding Buffer Killer) ---
  const userGlobalUploadLimBytes = Math.floor(Number(settings.uploadLimit ?? 0) * 1024);
  // If the user turned off uploading (Limit=0) or we are dying on memory, throttle uploads down to physical 1 Byte/sec.
  // We don't set to 0 or undefined, because that physically implies "Unlimited" to webtorrent's speedo package.
  const targetUploadLimitBytes = (userGlobalUploadLimBytes <= 0 || rssBytes >= MEMORY_PRESSURE_HIGH_BYTES) 
    ? 1 
    : userGlobalUploadLimBytes;

  if (Number(clientRef.uploadLimit ?? -1) !== targetUploadLimitBytes) {
    clientRef.uploadLimit = targetUploadLimitBytes;
    changed = true; // Update throttle so we instantly stop reading 80MB of chunks back from disk into RAM
  }

  if (changed) {
    await emitEvent({
      type: "adaptive_tuning",
      sessionId: managedSession.session.sessionId,
      data: {
        maxRequests: targetMaxRequests,
        strategy: targetStrategy,
        speedMbps: Number(speedMbps.toFixed(2)),
        peers,
        rssMiB: Number((rssBytes / (1024 * 1024)).toFixed(1)),
        maxPeers: targetPeerCap,
        downloadLimitKb: targetDownloadLimitKb,
      },
    });
  }
};

const updateManagedSessionSnapshot = async (managedSession: ManagedSession) => {
  const torrent = managedSession.torrent;
  if (!torrent) {
    return;
  }

  // Determine if it actually progressed to avoid spamming I/O
  const prevDownloadedBytes = managedSession.progress?.downloadedBytes ?? 0;
  const prevActivePeers = managedSession.progress?.activePeers ?? 0;
  const now = Date.now();
  const turboMode = getGlobalSettings().turboMode;

  managedSession.progress = computeProgress(torrent);

  const previousCompleted = turboMode ? null : new Set(managedSession.session.completedPieces ?? []);
  const pieceRefreshIntervalMs = turboMode
    ? managedSession.progress.activePeers > 0
      ? 12000
      : 5000
    : 1000;
  const shouldRefreshPieceStates =
    managedSession.pieceStates.length === 0 ||
    managedSession.progress.progress >= 100 ||
    now - (managedSession.lastPieceStateRefreshAt ?? 0) >= pieceRefreshIntervalMs;

  if (shouldRefreshPieceStates) {
    managedSession.pieceStates = updatePieceStatesInPlace(torrent, managedSession.pieceStates);
    managedSession.lastPieceStateRefreshAt = now;
  }

  const peerRefreshIntervalMs = managedSession.progress.activePeers > 0 ? 3000 : 1000;
  const shouldRefreshPeerStates =
    !turboMode &&
    (managedSession.peerStates.length === 0 ||
      managedSession.progress.activePeers !== prevActivePeers ||
      now - (managedSession.lastPeerStateRefreshAt ?? 0) >= peerRefreshIntervalMs);

  if (shouldRefreshPeerStates) {
    managedSession.peerStates = updatePeerStatesInPlace(torrent, managedSession.peerStates);
    managedSession.lastPeerStateRefreshAt = now;
  }

  managedSession.latestFilePath = getFilePathForDownload(managedSession, torrent);

  managedSession.session.progress = managedSession.progress.progress;
  managedSession.session.peers = getPeersFromTorrent(torrent);
  managedSession.session.pieceCount = managedSession.progress.piecesTotal;

  if (shouldRefreshPieceStates) {
    managedSession.session.completedPieces = managedSession.pieceStates
      .filter((piece) => piece.completed)
      .map((piece) => piece.index);
  } else if (managedSession.progress.progress >= 100) {
    managedSession.session.completedPieces = Array.from(
      { length: managedSession.progress.piecesTotal },
      (_, pieceIndex) => pieceIndex
    );
  }

  const newlyVerifiedPieces = previousCompleted
    ? managedSession.session.completedPieces.filter((pieceIndex) => !previousCompleted.has(pieceIndex))
    : [];

  // Only sync to disk every 5 seconds to reduce brutal lag, OR if it hits 100%.
  const shouldSync = (now - (managedSession.session.updatedAt ?? 0) > 5000) || managedSession.progress.progress === 100;
  if (shouldSync) {
      managedSession.session.updatedAt = now;
  }

  if (managedSession.session.status === "starting" && managedSession.progress.activePeers > 0) {
    managedSession.session.status = "running";
  }

  if (managedSession.progress.progress >= 100 && managedSession.session.status !== "completed") {
    managedSession.session.status = "completed";
  }

  if (shouldSync) {
    await syncSession(managedSession.session);
  }

  if (newlyVerifiedPieces.length > 0) {
    const peersNow = managedSession.progress.activePeers;
    for (const pieceIndex of newlyVerifiedPieces.slice(0, 3)) {
      await emitEvent({
        type: "piece_verified",
        sessionId: managedSession.session.sessionId,
        data: {
          pieceIndex,
          hash: "sha1",
          result: "ok",
        },
      });

      await emitEvent({
        type: "peer_have_piece",
        sessionId: managedSession.session.sessionId,
        data: {
          pieceIndex,
          peers: peersNow,
        },
      });
    }
  }

  const isTransferStalled = managedSession.progress.downloadedBytes <= prevDownloadedBytes;
  const lowThroughput = managedSession.progress.downloadSpeed < 220 * 1024;
  const shouldKickTrackerRecovery =
    managedSession.session.status === "running" &&
    managedSession.progress.progress < 100 &&
    lowThroughput &&
    isTransferStalled &&
    now - (managedSession.lastReannounceAt ?? 0) >= 20000;

  if (shouldKickTrackerRecovery) {
    managedSession.lastReannounceAt = now;
    void triggerTrackerReannounce(managedSession, "manual");
  }

  await flushWireTelemetry(managedSession);
  await tuneAdaptiveWebTorrent(managedSession);

  // Throttle websocket emissions as well to only when progressing
  if (prevDownloadedBytes !== managedSession.progress.downloadedBytes || managedSession.progress.progress === 100) {
    await emitEvent({
      type: "download_progress",
      sessionId: managedSession.session.sessionId,
      data: {
        ...managedSession.progress,
      },
    });
  }
};

const waitForMetadata = (torrent: TorrentLike) =>
  new Promise<void>((resolve) => {
    if (torrent?.ready) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => resolve(), 12000);
    torrent.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });
    torrent.once("metadata", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

const destroyTorrentSafely = async (managedSession: ManagedSession, reason: "pause" | "stop" | "replace") => {
  if (managedSession.snapshotTimer) {
    clearInterval(managedSession.snapshotTimer);
    managedSession.snapshotTimer = undefined;
  }

  const current = managedSession.torrent;
  if (!current) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    try {
      current.destroy?.({ destroyStore: false }, done);
      setTimeout(done, 2000);
    } catch {
      done();
    }
  });

  managedSession.torrent = undefined;

  await emitEvent({
    type: "log",
    sessionId: managedSession.session.sessionId,
    data: {
      message: `torrent_teardown_${reason}`,
    },
  });
};

const triggerTrackerReannounce = async (
  managedSession: ManagedSession,
  reason: "idle_no_peers" | "manual"
): Promise<boolean> => {
  if (!managedSession.torrent) {
    return false;
  }

  try {
    const liveTorrent = managedSession.torrent as any;
    const discovery = liveTorrent?.discovery ?? liveTorrent?._discovery;

    if (typeof discovery?.tracker?.update === "function") {
      discovery.tracker.update();
    } else if (typeof discovery?.tracker?.announce === "function") {
      discovery.tracker.announce();
    } else if (typeof liveTorrent?.resume === "function") {
      liveTorrent.resume();
    }

    await emitEvent({
      type: "tracker_reannounce",
      sessionId: managedSession.session.sessionId,
      data: {
        reason,
      },
    });

    return true;
  } catch (error) {
    return false;
  }
};

const bindTorrentEvents = (managedSession: ManagedSession) => {
  const torrent = managedSession.torrent;
  if (!torrent) {
    return;
  }

  const sessionId = managedSession.session.sessionId;

  const getReannounceIntervalMs = () => {
    const configuredSeconds = Number(getGlobalSettings().trackerAnnounceInterval ?? 30);
    if (!Number.isFinite(configuredSeconds) || configuredSeconds <= 0) {
      return 30000;
    }
    return Math.max(10000, Math.floor(configuredSeconds * 1000));
  };

  const maybeReannounceForIdleSession = () => {
    if (!managedSession.torrent) {
      return;
    }

    const status = managedSession.session.status;
    if (status !== "running" && status !== "starting") {
      return;
    }

    const hasDownloadedBytes = (managedSession.progress.downloadedBytes ?? 0) > 0;
    const hasPeers = (managedSession.progress.activePeers ?? 0) > 0;
    if (hasDownloadedBytes || hasPeers) {
      return;
    }

    const now = Date.now();
    const lastReannounceAt = managedSession.lastReannounceAt ?? 0;
    if (now - lastReannounceAt < getReannounceIntervalMs()) {
      return;
    }

    managedSession.lastReannounceAt = now;

    void triggerTrackerReannounce(managedSession, "idle_no_peers");
  };

  torrent.on("wire", async (wire: any) => {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    const peerLabel = getPeerLabel(wire, { ip: address.ip, port: resolvedPort });

    const fire = (type: string, data: Record<string, unknown>) => {
      void emitEvent({
        type,
        sessionId: managedSession.session.sessionId,
        data,
      });
    };

    if (!getGlobalSettings().turboMode) {
      fire("peer_handshake", {
        ip: address.ip,
        port: resolvedPort,
        peerId: wire?.peerId,
        peerLabel,
        transport: "tcp",
      });

      const peerPieces = wire?.peerPieces;
      let piecesAvailable: number | null = null;
      if (Array.isArray(peerPieces)) {
        piecesAvailable = peerPieces.filter(Boolean).length;
      } else if (peerPieces && typeof peerPieces.get === "function") {
        const pieceUniverse = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
        if (pieceUniverse > 0) {
          let count = 0;
          for (let index = 0; index < pieceUniverse; index += 1) {
            if (peerPieces.get(index)) {
              count += 1;
            }
          }
          piecesAvailable = count;
        }
      }

      if (typeof piecesAvailable === "number") {
        fire("peer_bitfield", {
          ip: address.ip,
          port: resolvedPort,
          peerId: wire?.peerId,
          peerLabel,
          piecesAvailable,
        });
      }

      wire.on("interested", () => {
        fire("peer_interested", {
          ip: address.ip,
          port: resolvedPort,
          peerId: wire?.peerId,
          peerLabel,
        });
      });

      wire.on("unchoke", () => {
        fire("peer_unchoked", {
          ip: address.ip,
          port: resolvedPort,
          peerId: wire?.peerId,
          peerLabel,
        });
      });
    }

    wire.on("request", (pieceIndex: number, offset: number, length: number) => {
      void pieceIndex;
      void offset;
      void length;
      if (getGlobalSettings().turboMode) {
        return;
      }
      managedSession.wireTelemetry.requestedBlocks += 1;
    });

    wire.on("piece", (pieceIndex: number, offset: number, buffer: Buffer) => {
      void pieceIndex;
      void offset;
      if (getGlobalSettings().turboMode) {
        return;
      }
      managedSession.wireTelemetry.receivedBlocks += 1;
      managedSession.wireTelemetry.receivedBytes += Number(buffer?.length ?? 0);
      managedSession.wireTelemetry.receivedPeers.add(`${address.ip}:${resolvedPort}`);
    });

    wire.on("close", () => {
      // no-op
    });
  });

  torrent.on("done", async () => {
    logger.info(`[Torrent: ${sessionId}] Download complete. Stitching files...`);
    try {
      const storagePaths = getSessionStoragePaths(sessionId, managedSession.session.fileName, managedSession.savePath);
      await stitchPieceFiles(sessionId, storagePaths.sessionDir, torrent.files);
      logger.info(`[Torrent: ${sessionId}] Files stitched successfully.`);
    } catch (err) {
      logger.error(`[Torrent: ${sessionId}] File stitching failed:`, err);
    }
    
    managedSession.session.status = "completed";
    await updateManagedSessionSnapshot(managedSession);

    await emitEvent({
      type: "torrent_completed",
      sessionId: managedSession.session.sessionId,
      data: {
        fileName: managedSession.session.fileName,
        infoHash: managedSession.session.infoHash,
      },
    });
  });

  torrent.on("error", async (error: Error) => {
    logger.error(`[Torrent: ${sessionId}] ERROR:`, error.message, error.stack ?? "");

    managedSession.session.status = "error";
    managedSession.session.updatedAt = Date.now();
    await syncSession(managedSession.session);

    await emitEvent({
      type: "torrent_error",
      sessionId: managedSession.session.sessionId,
      data: {
        message: error.message,
      },
    });
  });

  managedSession.snapshotTimer = setInterval(async () => {
    if (managedSession.session.status === "running" || managedSession.session.status === "starting") {
      // Don't fully await it completely blocking the loop if it's lagging
      updateManagedSessionSnapshot(managedSession)
        .then(() => {
          maybeReannounceForIdleSession();
        })
        .catch((error) => {
          logger.error(
            `[Torrent: ${sessionId}] Snapshot update failed:`,
            error instanceof Error ? error.message : String(error)
          );
        });
    }
  }, 1000);
};


const attachTorrentToManagedSession = async (managedSession: ManagedSession, fallbackName: string) => {
  const storage = getSessionStoragePaths(managedSession.session.sessionId, fallbackName, managedSession.savePath);
  ensureSessionStorage(storage);

  const settings = getGlobalSettings();
  const sourceTrackers = extractTrackersFromSource(managedSession.source, managedSession.sourceType);
  const announcePool = getTrackerPool(sourceTrackers);
  const sessionId = managedSession.session.sessionId;

  const clientRef = client as any;

  const maxPeers = Number(settings.maxPeers ?? 0);
  const normalizedMaxPeers = Number.isFinite(maxPeers) && maxPeers > 0 ? Math.max(32, Math.floor(maxPeers)) : 120;
  const effectiveMaxPeers = DISK_SAFETY_GUARD.enabled
    ? Math.min(normalizedMaxPeers, DISK_SAFETY_GUARD.maxPeers)
    : normalizedMaxPeers;
  clientRef.maxConns = effectiveMaxPeers;

  const configuredDownloadLimitKb = Number(settings.downloadLimit ?? 0);
  const uploadLimitKb = Number(settings.uploadLimit ?? 0);
  let effectiveDownloadLimitKb =
    Number.isFinite(configuredDownloadLimitKb) && configuredDownloadLimitKb > 0
      ? Math.floor(configuredDownloadLimitKb)
      : 0;

  if (DISK_SAFETY_GUARD.enabled) {
    // Enforce a hard write-rate ceiling to protect SSD from sustained 100% active time.
    effectiveDownloadLimitKb =
      effectiveDownloadLimitKb > 0
        ? Math.min(effectiveDownloadLimitKb, DISK_SAFETY_GUARD.maxDownloadKb)
        : DISK_SAFETY_GUARD.maxDownloadKb;
  }

  if (Number.isFinite(effectiveDownloadLimitKb) && effectiveDownloadLimitKb > 0) {
    clientRef.downloadLimit = Math.floor(effectiveDownloadLimitKb * 1024);
  } else {
    clientRef.downloadLimit = undefined;
  }

  if (Number.isFinite(uploadLimitKb) && uploadLimitKb > 0) {
    clientRef.uploadLimit = Math.floor(uploadLimitKb * 1024);
  } else {
    // If the GUI passed uploadLimit 0 to mean 'Disable Seeding', passing undefined unleashes "Unlimited" bandwidth
    // and causes a 1+ GB RAM bloat reading chunks to upload. Instead we choke it to 1 byte/s.
    clientRef.uploadLimit = 1;
  }

  const maxRequests = Number(settings.maxRequestsPerPeer ?? 10);
  let normalizedMaxRequests = Number.isFinite(maxRequests) && maxRequests > 0 ? Math.floor(maxRequests) : 10;
  if (DISK_SAFETY_GUARD.enabled) {
    normalizedMaxRequests = Math.min(normalizedMaxRequests, DISK_SAFETY_GUARD.maxRequestsPerPeer);
  }

  if (DISK_SAFETY_GUARD.enabled) {
    logger.info(
      `[SafetyGuard] ${sessionId}: download<=${effectiveDownloadLimitKb}KB/s peers<=${effectiveMaxPeers} maxReq<=${normalizedMaxRequests}`
    );
  }

  const enableDht = settings.enableDHT !== false;
  const rawNumwant = Number(settings.trackerNumwant ?? 250);
  const trackerNumwant = Number.isFinite(rawNumwant)
    ? Math.max(20, Math.min(500, Math.floor(rawNumwant)))
    : 250;
  
  const torrent = client.add(managedSession.source, {
    path: storage.sessionDir,
    announce: announcePool,
    destroyStoreOnDestroy: false,
    dht: enableDht,
    store: createPieceStore(managedSession.session.sessionId, managedSession.savePath) as any,
    // Apply user settings to this torrent
    maxRequests: normalizedMaxRequests,
    getAnnounceOpts: () => ({
      numwant: trackerNumwant,
    }),
  });


  managedSession.adaptiveMaxRequests = normalizedMaxRequests;
  managedSession.adaptiveStrategy = settings.pieceSelectionStrategy;

  managedSession.torrent = torrent;
  bindTorrentEvents(managedSession);

  // Apply initial piece selection strategy for this session.
  try {
    applyPieceSelectionStrategy(torrent, managedSession.adaptiveStrategy);
  } catch (err) {
    // Ignore unsupported selection strategy behavior in some WebTorrent versions.
  }

  await waitForMetadata(torrent);

  managedSession.session.fileName = String(torrent?.name ?? fallbackName);
  managedSession.session.infoHash = String(torrent?.infoHash ?? "pending");

  const announces = Array.isArray(torrent?.announce) ? torrent.announce : [];
  managedSession.session.trackerUrl = announces.length > 0 ? String(announces[0]) : "DHT";
  managedSession.session.pieceCount = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  managedSession.session.updatedAt = Date.now();

  if (announces.length > 0) {
    logger.info(`[Torrent: ${sessionId}] Trackers used (${announces.length}): ${announces.join(", ")}`);
  } else {
    logger.info(`[Torrent: ${sessionId}] Trackers used: DHT only`);
  }

  logger.info(
    `[Torrent: ${sessionId}] Discovery config: dht=${enableDht ? "on" : "off"} numwant=${trackerNumwant} sourceTrackers=${sourceTrackers.length}`
  );

  writeDownloadMetadata(storage, {
    sessionId: managedSession.session.sessionId,
    fileName: managedSession.session.fileName,
    infoHash: managedSession.session.infoHash,
    pieceHashes: [],
    pieceLength: Number(torrent?.pieceLength ?? 0),
    totalLength: Number(torrent?.length ?? 0),
    createdAt: Date.now(),
  });

  return { torrent, announces };
};


// Parse torrent metadata and extract file list without starting download
export const parseTorrent = async (options: StartTorrentOptions): Promise<TorrentFileInfo[]> => {
  const { source, sourceType } = getSourceAndType(options);
  
  // For .torrent files, decode directly to bypass WebTorrent's unreliability with `torrent.files` sync
  if (sourceType === "torrent-file" && Buffer.isBuffer(source)) {
    return decodeTorrentFiles(source);
  }
  
  // For magnet links, we must use WebTorrent to fetch the metadata from peers.
  const tempClient = new WebTorrent({
    dht: false,
    tracker: false,
    utp: WEBTORRENT_UTP_ENABLED,
  });

  return new Promise((resolve, reject) => {
    let isResolved = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = (isError: boolean = false) => {
      if (timeout) clearTimeout(timeout);
      try {
        if (tempClient && typeof tempClient.destroy === "function") {
          tempClient.destroy(() => undefined);
        }
      } catch (err) {
        // no-op
      }
    };

    const finalize = (callback: () => void) => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      callback();
    };

    timeout = setTimeout(() => {
      finalize(() => {
        reject(new Error("Timeout parsing torrent (15s) - torrent metadata not received"));
      });
    }, 15000); // 15 second timeout instead of 30

    try {
      const torrent = tempClient.add(source);

      // Listen for metadata or ready event
      const onMetadata = () => {
        finalize(() => {
          try {
            const files: any[] = Array.isArray(torrent.files) ? torrent.files : [];
            
            const fileInfos: TorrentFileInfo[] = files.map((file, index) => ({
              index,
              name: String(file.name ?? `file-${index}`),
              path: String(file.path ?? file.name ?? `file-${index}`),
              length: Number(file.length ?? 0),
              selected: true,
            }));

            resolve(fileInfos);
          } catch (err) {
            reject(new Error(`Failed to parse file list: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      };

      torrent.once("metadata", onMetadata);
      torrent.once("ready", onMetadata);

      torrent.on("error", (err: Error) => {
        finalize(() => {
          reject(new Error(`Failed to parse torrent: ${err.message}`));
        });
      });
    } catch (err) {
      finalize(() => {
        reject(new Error(`Exception parsing torrent: ${err instanceof Error ? err.message : String(err)}`));
      });
    }
  });
};

export const startTorrent = async (options: StartTorrentOptions) => {
  const sessionId = options.sessionId ?? `raw-${Date.now().toString(36)}`;

  const existing = managed.get(sessionId);
  if (existing) {
    if (existing.snapshotTimer) {
      clearInterval(existing.snapshotTimer);
      existing.snapshotTimer = undefined;
    }

    if (existing.torrent) {
      await destroyTorrentSafely(existing, "replace");
    }
  }

  const { source, sourceType } = getSourceAndType(options);
  const fallbackName = options.fileName ?? "download.bin";
  const selectedFileIndices = normalizeSelectedFileIndices(options.selectedFileIndices);

  const session: TorrentSessionState = {
    sessionId,
    fileName: fallbackName,
    infoHash: "pending",
    trackerUrl: "pending",
    peerId: `raw-${Math.random().toString(36).slice(2, 14)}`,
    peers: [],
    pieceCount: 0,
    completedPieces: [],
    progress: 0,
    status: "starting",
    seeding: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userId: options.userId,
  };

  const managedSession: ManagedSession = {
    session,
    source,
    sourceType,
    selectedFileIndices,
    savePath: options.savePath,
    pieceStates: [],
    peerStates: [],
    progress: {
      totalBytes: 0,
      downloadedBytes: 0,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      activePeers: 0,
      discoveredPeers: 0,
      piecesCompleted: 0,
      piecesTotal: 0,
      eta: -1,
      downloadSpeedMbps: "0.00",
      etaFormatted: "calculating...",
    },
    latestFilePath: null,
    lastReannounceAt: Date.now(),
    lastPeerStateRefreshAt: 0,
    adaptiveMaxRequests: Number(getGlobalSettings().maxRequestsPerPeer ?? 10),
    adaptiveStrategy: getGlobalSettings().pieceSelectionStrategy,
    wireTelemetry: {
      receivedBlocks: 0,
      receivedBytes: 0,
      receivedPeers: new Set<string>(),
      requestedBlocks: 0,
    },
  };

  if (sourceType === "torrent-file") {
    ensurePersistentSourceForManagedSession(managedSession);
  }

  sessions.set(sessionId, session);
  managed.set(sessionId, managedSession);
  await syncSession(session);

  let announces: string[] = [];
  let torrent: TorrentLike | undefined;

  const webAttach = await attachTorrentToManagedSession(managedSession, fallbackName);
  torrent = webAttach.torrent;
  announces = webAttach.announces;

  // Handle file selection: explicitly select/deselect files
  const files: any[] = Array.isArray(torrent?.files) ? torrent.files : [];
  if (selectedFileIndices) {
    // Deselect unselected files
    const selectedSet = new Set(selectedFileIndices);
    for (let i = 0; i < files.length; i++) {
      if (!selectedSet.has(i) && typeof files[i]?.deselect === "function") {
        files[i].deselect();
      }
    }
  } else {
    // If no selection provided, ensure all files are explicitly selected
    for (let i = 0; i < files.length; i++) {
      if (typeof files[i]?.select === "function") {
        files[i].select();
      }
    }
  }

  // DUPLICATE CHECK: Check if this infoHash already exists in other active sessions
  const infoHash = session.infoHash;
  if (infoHash && infoHash !== "pending") {
    for (const [existingSessionId, existingSession] of sessions.entries()) {
      if (existingSessionId !== sessionId && existingSession.infoHash === infoHash) {
        // Clean up the session we just created
        sessions.delete(sessionId);
        managed.delete(sessionId);
        removeResumableSession(sessionId);
        if (managedSession.snapshotTimer) {
          clearInterval(managedSession.snapshotTimer);
          managedSession.snapshotTimer = undefined;
        }

        await destroyTorrentSafely(managedSession, "stop");
        
        throw new Error(
          `⚠️ This torrent is already being downloaded! Session: ${existingSessionId}. Check the dashboard to view the existing download.`
        );
      }
    }
  }

  session.status = "running";
  session.updatedAt = Date.now();

  await syncSession(session);
  await updateManagedSessionSnapshot(managedSession);

  await emitEvent({
    type: "torrent_started",
    sessionId,
    data: {
      fileName: session.fileName,
      infoHash: session.infoHash,
      trackerUrl: session.trackerUrl,
      trackerCount: announces.length,
      sourceType,
    },
  });

  return {
    session,
    parsedTorrent: {
      fileName: session.fileName,
      sourceType,
      trackerUrl: session.trackerUrl,
      trackerUrls: announces,
      infoHash: session.infoHash,
      pieceLength: Number(torrent?.pieceLength ?? 0),
      pieceHashes: [],
      totalLength: Number(torrent?.length ?? managedSession.progress.totalBytes ?? 0),
      announceList: announces,
    },
  };
};

export const getTorrentSession = async (sessionId: string) => {
  const inMemory = sessions.get(sessionId);
  if (inMemory) {
    return inMemory;
  }

  return loadSession(sessionId);
};

export const getUserSessions = async (userId: string) => listSessionsByUser(userId);

export const getDownloadManager = (_sessionId: string): undefined => undefined;

export const getDownloadProgress = (sessionId: string): DownloadProgress | null => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return null;
  }

  // Use the cached value from snapshot timer
  return managedSession.progress;
};

export const getPieceStates = (sessionId: string): PieceState[] => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return [];
  }

  // Use the cached value from snapshot timer
  return managedSession.pieceStates;
};

export const getPeerDownloadStates = (sessionId: string): PeerDownloadState[] => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return [];
  }

  // Use the cached value from snapshot timer
  return managedSession.peerStates;
};

export const getDownloadedFile = (sessionId: string): Buffer | null => {
  const info = getDownloadedFileInfo(sessionId);
  if (!info || !fs.existsSync(info.path)) {
    return null;
  }

  return fs.readFileSync(info.path);
};

export const getDownloadedFileInfo = (sessionId: string): { path: string; size: number } | null => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return null;
  }

  const filePath = managedSession.torrent
    ? getFilePathForDownload(managedSession, managedSession.torrent)
    : managedSession.latestFilePath;
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
  };
};

export const getWebTorrentFile = (sessionId: string): any => {
  const managedSession = managed.get(sessionId);
  if (!managedSession || !managedSession.torrent) {
    return null;
  }
  const files: any[] = Array.isArray(managedSession.torrent.files) ? managedSession.torrent.files : [];
  if (files.length === 0) return null;
  return files.slice().sort((a, b) => (b.length ?? 0) - (a.length ?? 0))[0];
};

export const pauseTorrent = async (sessionId: string): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return false;
  }

  if (managedSession.session.status === "paused") {
    return true;
  }

  if (managedSession.session.status === "completed" || managedSession.session.status === "error") {
    return false;
  }

  try {
    managedSession.session.status = "paused";
    managedSession.session.updatedAt = Date.now();
    await syncSession(managedSession.session);

    await emitEvent({
      type: "torrent_paused",
      sessionId,
      data: {
        progress: managedSession.session.progress,
      },
    });

    if (managedSession.torrent) {
      if (typeof managedSession.torrent.pause === "function") {
        managedSession.torrent.pause();
      } else if (!pauseTeardownTasks.has(sessionId)) {
        const teardownTask = (async () => {
          try {
            await destroyTorrentSafely(managedSession, "pause");
          } catch (error) {
            await emitEvent({
              type: "torrent_error",
              sessionId,
              data: {
                message: error instanceof Error ? error.message : "pause_teardown_failed",
              },
            });
          } finally {
            pauseTeardownTasks.delete(sessionId);
          }
        })();

        pauseTeardownTasks.set(sessionId, teardownTask);
      }
    }

    return true;
  } catch (error) {
    await emitEvent({
      type: "torrent_error",
      sessionId,
      data: {
        message: error instanceof Error ? error.message : "pause_failed",
      },
    });
    return false;
  }
};

export const resumeTorrent = async (sessionId: string): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return false;
  }

  if (managedSession.session.status === "running") {
    return true;
  }

  if (managedSession.session.status !== "paused" && managedSession.session.status !== "starting") {
    return false;
  }

  try {
    const teardownTask = pauseTeardownTasks.get(sessionId);
    if (teardownTask) {
      await Promise.race([
        teardownTask,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }

    if (!managedSession.torrent) {
      await attachTorrentToManagedSession(managedSession, managedSession.session.fileName);
    } else if (typeof managedSession.torrent.resume === "function") {
      managedSession.torrent.resume();
    }

    managedSession.session.status = "running";
    managedSession.session.updatedAt = Date.now();
    await syncSession(managedSession.session);
    await updateManagedSessionSnapshot(managedSession);

    await emitEvent({
      type: "torrent_resumed",
      sessionId,
      data: {
        progress: managedSession.session.progress,
      },
    });

    return true;
  } catch (error) {
    await emitEvent({
      type: "torrent_error",
      sessionId,
      data: {
        message: error instanceof Error ? error.message : "resume_failed",
      },
    });
    return false;
  }
};

export const stopTorrent = async (sessionId: string): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return false;
  }

  try {
    if (managedSession.snapshotTimer) {
      clearInterval(managedSession.snapshotTimer);
      managedSession.snapshotTimer = undefined;
    }

    await destroyTorrentSafely(managedSession, "stop");

    managedSession.session.status = "error";
    managedSession.session.updatedAt = Date.now();
    await syncSession(managedSession.session);

    await emitEvent({
      type: "torrent_stopped",
      sessionId,
      data: {
        progress: managedSession.session.progress,
      },
    });

    return true;
  } catch (error) {
    await emitEvent({
      type: "torrent_error",
      sessionId,
      data: {
        message: error instanceof Error ? error.message : "stop_failed",
      },
    });
    return false;
  }
};

export const deleteTorrentSession = async (
  sessionId: string
): Promise<{ removedSession: boolean; removedFiles: boolean }> => {
  const managedSession = managed.get(sessionId);
  const persistedSession = sessions.get(sessionId) ?? (await loadSession(sessionId));
  const session = managedSession?.session ?? persistedSession ?? null;

  try {
    const teardownTask = pauseTeardownTasks.get(sessionId);
    if (teardownTask) {
      await Promise.race([
        teardownTask,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }

    if (managedSession?.snapshotTimer) {
      clearInterval(managedSession.snapshotTimer);
      managedSession.snapshotTimer = undefined;
    }

    if (managedSession?.torrent) {
      await destroyTorrentSafely(managedSession, "stop");
    }
  } catch (error) {
    logger.warn(
      `[DeleteSession] Failed to fully teardown session ${sessionId}`,
      error instanceof Error ? error.message : String(error)
    );
  }

  sessions.delete(sessionId);
  managed.delete(sessionId);
  pauseTeardownTasks.delete(sessionId);
  removeResumableSession(sessionId);

  const removedFiles = deleteSessionStorage(sessionId);

  await deleteSessionPersistence(sessionId, session?.userId);

  return {
    removedSession: Boolean(session),
    removedFiles,
  };
};

export const getTorrentStatus = (sessionId: string) => {
  const managedSession = managed.get(sessionId);
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  const progress = managedSession?.torrent
    ? computeProgress(managedSession.torrent)
    : managedSession?.progress;

  return {
    sessionId,
    status: session.status,
    progress: progress?.progress ?? session.progress,
    isDownloading: session.status === "running",
    peerCount: progress?.activePeers ?? session.peers.length,
    activePeerCount: progress?.activePeers ?? 0,
  };
};

export const reannounceTorrentDiscovery = async (sessionId: string): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return false;
  }

  if (!managedSession.torrent) {
    return false;
  }

  managedSession.lastReannounceAt = Date.now();
  return triggerTrackerReannounce(managedSession, "manual");
};

export const setSeedingEnabled = async (sessionId: string, enabled: boolean): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
    return false;
  }

  if (enabled && getGlobalSettings().turboMode) {
    logger.info(`[Seeding] Blocked enable for ${sessionId} because Turbo Mode is active`);
    return false;
  }

  try {
    managedSession.session.seeding = enabled;
    managedSession.session.updatedAt = Date.now();
    await syncSession(managedSession.session);

    await emitEvent({
      type: enabled ? "torrent_seeding_started" : "torrent_seeding_stopped",
      sessionId,
      data: {
        seeding: enabled,
      },
    });

    return true;
  } catch (error) {
    await emitEvent({
      type: "torrent_error",
      sessionId,
      data: {
        message: error instanceof Error ? error.message : "seeding_toggle_failed",
      },
    });
    return false;
  }
};

export const enforceTurboModeSeedingPolicy = async (): Promise<number> => {
  if (!getGlobalSettings().turboMode) {
    return 0;
  }

  let disabledSessions = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (!session.seeding) {
      continue;
    }

    const managedSession = managed.get(sessionId);
    const updatedAt = Date.now();

    session.seeding = false;
    session.updatedAt = updatedAt;

    if (managedSession) {
      managedSession.session.seeding = false;
      managedSession.session.updatedAt = updatedAt;
    }

    await syncSession(session);

    await emitEvent({
      type: "torrent_seeding_stopped",
      sessionId,
      data: {
        seeding: false,
        reason: "turbo_mode_policy",
      },
    });

    disabledSessions += 1;
  }

  return disabledSessions;
};

type AutoResumeSummary = {
  attempted: number;
  restored: number;
  skipped: number;
  failed: number;
};


export const restorePersistedTorrentsOnBoot = async (): Promise<AutoResumeSummary> => {
  if (!AUTO_RESUME_ON_BOOT) {
    return { attempted: 0, restored: 0, skipped: 0, failed: 0 };
  }

  const persisted = listResumableSessions();
  if (persisted.length === 0) {
    return { attempted: 0, restored: 0, skipped: 0, failed: 0 };
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;

  logger.info(`[AutoResume] Found ${persisted.length} persisted session(s)`);

  for (const record of persisted.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    if (!isResumableStatus(record.status)) {
      skipped += 1;
      removeResumableSession(record.sessionId);
      continue;
    }

    if (managed.has(record.sessionId)) {
      skipped += 1;
      continue;
    }

    const sourceOptions = buildRestoreSourceOptions(record);
    if (!sourceOptions) {
      skipped += 1;
      removeResumableSession(record.sessionId);
      logger.warn(`[AutoResume] Missing source for session ${record.sessionId}; removed persisted record`);
      continue;
    }

    try {
      await startTorrent({
        ...sourceOptions,
        sessionId: record.sessionId,
        userId: record.userId ?? "local-user",
        fileName: record.fileName,
        selectedFileIndices: record.selectedFileIndices,
        savePath: record.savePath,
      });

      if (record.status === "paused") {
        await pauseTorrent(record.sessionId);
      }

      if (record.seeding) {
        await setSeedingEnabled(record.sessionId, true);
      }

      restored += 1;
      logger.info(`[AutoResume] Restored ${record.sessionId} (${record.fileName})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicateRestoreError =
        message.includes("already being downloaded") ||
        message.includes("Cannot add duplicate torrent");

      if (duplicateRestoreError) {
        skipped += 1;
        removeResumableSession(record.sessionId);
        logger.warn(`[AutoResume] Skipping duplicate session ${record.sessionId}: ${message}`);
        continue;
      }

      failed += 1;
      logger.error(
        `[AutoResume] Failed to restore ${record.sessionId}:`,
        message
      );
    }
  }

  const summary = {
    attempted: persisted.length,
    restored,
    skipped,
    failed,
  };

  logger.info(
    `[AutoResume] Summary attempted=${summary.attempted} restored=${summary.restored} skipped=${summary.skipped} failed=${summary.failed}`
  );

  return summary;
};

