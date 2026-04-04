import fs from "node:fs";
import path from "node:path";
import WebTorrent from "webtorrent";
import type { StartTorrentOptions, TorrentSessionState, TrackerPeerDescriptor } from "../types/torrent";
import { publishEvent } from "../redis/publisher";
import { appendSessionEvent, listSessionsByUser, loadSession, persistSession } from "./persistenceService";
import { ensureSessionStorage, getSessionStoragePaths, writeDownloadMetadata } from "./fileStorageService";

type TorrentLike = any;

type DownloadProgress = {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  piecesCompleted: number;
  piecesTotal: number;
  eta: number;
  downloadSpeedMbps: string;
  etaFormatted: string;
};

type PieceState = {
  index: number;
  hash: string;
  length: number;
  requested: boolean;
  completed: boolean;
};

type PeerDownloadState = {
  ip: string;
  port: number;
  peerId?: string;
  choked: boolean;
  piecesAvailable: number;
  downloadedBytes: number;
  pendingRequests: number;
};

type ManagedSession = {
  session: TorrentSessionState;
  torrent?: TorrentLike;
  source: string | Buffer;
  sourceType: "magnet" | "torrent-file";
  pieceStates: PieceState[];
  peerStates: PeerDownloadState[];
  progress: DownloadProgress;
  latestFilePath: string | null;
  snapshotTimer?: NodeJS.Timeout;
};

const sessions = new Map<string, TorrentSessionState>();
const managed = new Map<string, ManagedSession>();
const pauseTeardownTasks = new Map<string, Promise<void>>();

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://9.rarbg.to:2710/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.opentrackr.org:443/announce",
];

export const torrentSessions = sessions;

const client = new WebTorrent({
  dht: true,
  tracker: true,
  maxConns: Number(process.env.MAX_CONCURRENT_PEER_CONNECTIONS ?? 40), // Capped to 40 to prevent OOM/Disk Thrashing on large files
  downloadLimit: 25000000, // 25 MB/s global cap to prevent disk IO locking
});

client.on("error", (err: Error) => {
  console.error("[WebTorrent Engine Error] Fatal failure:", err.message);
});

const toFixedOne = (value: number) => Number(value.toFixed(1));

const formatEta = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "calculating...";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

const parsePeerAddress = (address: string | undefined) => {
  if (!address) {
    return { ip: "unknown", port: 0 };
  }

  const lastColon = address.lastIndexOf(":");
  if (lastColon === -1) {
    return { ip: address, port: 0 };
  }

  const ip = address.slice(0, lastColon);
  const port = Number(address.slice(lastColon + 1)) || 0;
  return { ip, port };
};

const emitEvent = async (event: {
  type: string;
  sessionId: string;
  data: Record<string, unknown>;
}) => {
  const payload = await publishEvent({
    ...event,
    timestamp: Date.now(),
  });

  await appendSessionEvent(payload);
};

const syncSession = async (session: TorrentSessionState) => {
  sessions.set(session.sessionId, session);
  await persistSession(session);
};

const getTrackerPool = () => {
  const configuredPrimary = (process.env.TORRENT_TRACKER_URL ?? "").trim();
  const configuredExtra = (process.env.EXTRA_TRACKERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set([configuredPrimary, ...configuredExtra, ...DEFAULT_TRACKERS].filter(Boolean)));
};

const getPeersFromTorrent = (torrent: TorrentLike): TrackerPeerDescriptor[] => {
  const wireList: any[] = Array.isArray(torrent?.wires) ? torrent.wires : [];
  const seen = new Set<string>();
  const peers: TrackerPeerDescriptor[] = [];

  for (const wire of wireList) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const key = `${address.ip}:${address.port}`;
    if (seen.has(key) || address.port <= 0) {
      continue;
    }

    seen.add(key);
    peers.push({ ip: address.ip, port: address.port, peerId: wire?.peerId });
  }

  return peers;
};

const getFilePathForDownload = (sessionId: string, torrent: TorrentLike): string | null => {
  const files: any[] = Array.isArray(torrent?.files) ? torrent.files : [];
  if (files.length === 0) {
    return null;
  }

  const preferred = files.slice().sort((a, b) => (b.length ?? 0) - (a.length ?? 0))[0];
  const storage = getSessionStoragePaths(sessionId, preferred?.name ?? "download.bin");

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

const updatePieceStatesInPlace = (torrent: TorrentLike, states: PieceState[]): PieceState[] => {
  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  const pieceLength = Number(torrent?.pieceLength ?? 0);

  if (piecesTotal <= 0) {
    return [];
  }

  if (states.length !== piecesTotal) {
    states.length = 0;
    for (let index = 0; index < piecesTotal; index += 1) {
      states.push({
        index,
        hash: "",
        length: pieceLength,
        requested: false,
        completed: Boolean(torrent?.bitfield?.get?.(index)),
      });
    }
    return states;
  }

  for (let index = 0; index < piecesTotal; index += 1) {
    states[index].completed = Boolean(torrent?.bitfield?.get?.(index));
  }

  return states;
};

const updatePeerStatesInPlace = (torrent: TorrentLike, states: PeerDownloadState[]): PeerDownloadState[] => {
  const wires: any[] = Array.isArray(torrent?.wires) ? torrent.wires : [];
  
  // Resize if needed (unlikely to need shrink unless peers dropped, but we map fresh to be safe if count changes vastly)
  // Instead of fully rebuilding, just map fresh. It's only ~100 objects maximum normally.
  states.length = 0;
  for (const wire of wires) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const piecesAvailable = Array.isArray(wire?.peerPieces)
      ? wire.peerPieces.filter(Boolean).length
      : Number(wire?.peerPieces?.length ?? 0);

    states.push({
      ip: address.ip,
      port: address.port,
      peerId: wire?.peerId,
      choked: Boolean(wire?.peerChoking),
      piecesAvailable,
      downloadedBytes: Number(wire?.downloaded ?? 0),
      pendingRequests: Array.isArray(wire?.requests) ? wire.requests.length : 0,
    });
  }

  return states;
};

const computeProgress = (torrent: TorrentLike): DownloadProgress => {
  const totalBytes = Number(torrent?.length ?? 0);
  const downloadedBytes = Number(torrent?.downloaded ?? 0);
  const downloadSpeed = Number(torrent?.downloadSpeed ?? 0);
  const uploadSpeed = Number(torrent?.uploadSpeed ?? 0);
  const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  let piecesCompleted = 0;

  if (piecesTotal > 0 && torrent?.bitfield?.get) {
    for (let index = 0; index < piecesTotal; index += 1) {
      if (torrent.bitfield.get(index)) {
        piecesCompleted += 1;
      }
    }
  }

  const activePeers = Number(Array.isArray(torrent?.wires) ? torrent.wires.length : 0);
  const remaining = Math.max(0, totalBytes - downloadedBytes);
  const eta = downloadSpeed > 0 ? Math.round(remaining / downloadSpeed) : -1;

  return {
    totalBytes,
    downloadedBytes,
    progress: toFixedOne(progress),
    downloadSpeed,
    uploadSpeed,
    activePeers,
    piecesCompleted,
    piecesTotal,
    eta,
    downloadSpeedMbps: (downloadSpeed / (1024 * 1024)).toFixed(2),
    etaFormatted: formatEta(eta),
  };
};

const updateManagedSessionSnapshot = async (managedSession: ManagedSession) => {
  const torrent = managedSession.torrent;
  if (!torrent) {
    return;
  }

  // Determine if it actually progressed to avoid spamming I/O
  const prevDownloadedBytes = managedSession.progress?.downloadedBytes ?? 0;

  managedSession.progress = computeProgress(torrent);
  managedSession.pieceStates = updatePieceStatesInPlace(torrent, managedSession.pieceStates);
  managedSession.peerStates = updatePeerStatesInPlace(torrent, managedSession.peerStates);
  managedSession.latestFilePath = getFilePathForDownload(managedSession.session.sessionId, torrent);

  managedSession.session.progress = managedSession.progress.progress;
  managedSession.session.peers = getPeersFromTorrent(torrent);
  managedSession.session.pieceCount = managedSession.progress.piecesTotal;
  managedSession.session.completedPieces = managedSession.pieceStates
    .filter((piece) => piece.completed)
    .map((piece) => piece.index);
  
  const now = Date.now();
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

const bindTorrentEvents = (managedSession: ManagedSession) => {
  const torrent = managedSession.torrent;
  if (!torrent) {
    return;
  }

  torrent.on("wire", async (wire: any) => {
    const address = parsePeerAddress(wire?.remoteAddress);
    // Log lightly on interval, or just let 'download' summarize it. 
    // console.log(`[Torrent: ${managedSession.session.sessionId}] [+] Peer Connected: ${address.ip}:${address.port}. Active Wires: ${torrent.wires?.length || 0}`);
    
    // REMOVED `await emitEvent({ type: "peer_connected" })` because it fired 100+ times per second 
    // during swarm discovery, completely crashing the React Frontend Map and bloating browser RAM.
    
    wire.on('close', () => {
       // console.log(`[Torrent: ${managedSession.session.sessionId}] [-] Peer Disconnected: ${address.ip}:${address.port}. Active Wires: ${torrent.wires?.length || 0}`);
    });
  });

  // Track raw chunks visually (throttled output to avoid console flood)
  let lastLogTime = Date.now();
  
  torrent.on("download", (bytes: number) => {
    const now = Date.now();
    if (now - lastLogTime > 5000) {
      console.log(`[Torrent: ${managedSession.session.sessionId}] Downloading... Speed: ${(torrent.downloadSpeed / (1024 * 1024)).toFixed(2)} MB/s, Active Peers: ${torrent.wires?.length || 0}`);
      lastLogTime = now;
    }
    // DO NOT invoke updateManagedSessionSnapshot here. It gets called 600x a sec and blocks the event loop!
  });

  torrent.on("upload", () => {
    // Similar to download, uploading chunks should not trigger huge state recalculations
  });

  torrent.on("warning", (err: Error) => {
    console.warn(`[Torrent: ${managedSession.session.sessionId}] WARNING:`, err.message);
  });

  torrent.on("done", async () => {
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
      updateManagedSessionSnapshot(managedSession).catch(console.error);
    }
  }, 1000);
};

const getSourceAndType = (options: StartTorrentOptions): { source: string | Buffer; sourceType: "magnet" | "torrent-file" } => {
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

const attachTorrentToManagedSession = async (managedSession: ManagedSession, fallbackName: string) => {
  const storage = getSessionStoragePaths(managedSession.session.sessionId, fallbackName);
  ensureSessionStorage(storage);

  const announcePool = getTrackerPool();
  const torrent = client.add(managedSession.source, {
    path: storage.sessionDir,
    announce: announcePool,
    destroyStoreOnDestroy: false,
  });

  managedSession.torrent = torrent;
  bindTorrentEvents(managedSession);

  await waitForMetadata(torrent);

  managedSession.session.fileName = String(torrent?.name ?? fallbackName);
  managedSession.session.infoHash = String(torrent?.infoHash ?? "pending");

  const announces = Array.isArray(torrent?.announce) ? torrent.announce : [];
  managedSession.session.trackerUrl = announces.length > 0 ? String(announces[0]) : "DHT";
  managedSession.session.pieceCount = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  managedSession.session.updatedAt = Date.now();

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

export const startTorrent = async (options: StartTorrentOptions) => {
  const sessionId = options.sessionId ?? `raw-${Date.now().toString(36)}`;

  const existing = managed.get(sessionId);
  if (existing?.torrent) {
    await destroyTorrentSafely(existing, "replace");
  }

  const { source, sourceType } = getSourceAndType(options);
  const fallbackName = options.fileName ?? "download.bin";

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
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userId: options.userId,
  };

  const managedSession: ManagedSession = {
    session,
    source,
    sourceType,
    pieceStates: [],
    peerStates: [],
    progress: {
      totalBytes: 0,
      downloadedBytes: 0,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      activePeers: 0,
      piecesCompleted: 0,
      piecesTotal: 0,
      eta: -1,
      downloadSpeedMbps: "0.00",
      etaFormatted: "calculating...",
    },
    latestFilePath: null,
  };

  sessions.set(sessionId, session);
  managed.set(sessionId, managedSession);
  await syncSession(session);

  const { torrent, announces } = await attachTorrentToManagedSession(managedSession, fallbackName);

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
      totalLength: Number(torrent?.length ?? 0),
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
    ? getFilePathForDownload(sessionId, managedSession.torrent)
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

    if (managedSession.torrent && !pauseTeardownTasks.has(sessionId)) {
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
