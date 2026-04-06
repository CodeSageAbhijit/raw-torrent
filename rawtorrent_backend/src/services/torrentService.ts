import fs from "node:fs";
import path from "node:path";
import WebTorrent from "webtorrent";
import bencode from "bencode";
import type {
  ResumableSessionRecord,
  StartTorrentOptions,
  TorrentFileInfo,
  TorrentSessionState,
  TrackerPeerDescriptor,
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
  loadSessionSourceTorrent,
  persistSessionSourceTorrent,
  removeResumableSession,
  upsertResumableSession,
  writeDownloadMetadata,
} from "./fileStorageService";
import { getGlobalSettings } from "../settings";
import { logger } from "../utils/logger";

type TorrentLike = any;

type DownloadProgress = {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  discoveredPeers: number;
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
  piecesAvailableKnown: boolean;
  downloadedBytes: number;
  pendingRequests: number;
  encryption: "unknown" | "plaintext" | "mse-rc4";
};

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

const SEQUENTIAL_SELECTION_PRIORITY = 999;
const SUPPORTED_TRACKER_PROTOCOLS = new Set(["udp:", "http:", "https:", "ws:", "wss:"]);

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

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

const extractTrackersFromSource = (source: string | Buffer, sourceType: "magnet" | "torrent-file"): string[] => {
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

    const decoded = bencode.decode(torrentBuffer) as Record<string, unknown>;
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

const DISK_SAFETY_GUARD = {
  enabled: process.env.DISK_SAFETY_GUARD !== "false",
  maxDownloadKb: parsePositiveInt(process.env.DISK_SAFETY_MAX_DOWNLOAD_KB, 12288),
  maxPeers: parsePositiveInt(process.env.DISK_SAFETY_MAX_PEERS, 120),
  maxRequestsPerPeer: parsePositiveInt(process.env.DISK_SAFETY_MAX_REQUESTS_PER_PEER, 24),
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

export const torrentSessions = sessions;

const client = new WebTorrent({
  dht: true,
  tracker: true,
  maxConns: 300, // Global connection pool - individual torrents will respect their per-session limits via settings
  // Intentionally omit downloadLimit. In this WebTorrent version,
  // 0 is treated as a hard stop rather than "unlimited".
});

client.on("error", (err: Error) => {
  logger.error("[WebTorrent Engine Error] Fatal failure:", err.message, err.stack ?? "");
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

const getPeerLabel = (wire: any, address: { ip: string; port: number }) => {
  const peerId = String(wire?.peerId ?? "").trim();
  if (peerId) {
    return `peer-${peerId.slice(-3)}`;
  }

  if (address.ip !== "unknown") {
    const compactIp = address.ip.split(".").slice(-2).join("-");
    return `peer-${compactIp}`;
  }

  return "peer-unk";
};

const inferPeerEncryption = (wire: any): "unknown" | "plaintext" | "mse-rc4" => {
  const encryptedFlags = [
    wire?.encrypted,
    wire?.isEncrypted,
    wire?._encrypted,
    wire?.peerEncrypted,
    wire?._pe1,
    wire?.cryptoHandshakeDone,
    wire?._cryptoHandshakeDone,
  ];

  if (encryptedFlags.some((value) => value === true)) {
    return "mse-rc4";
  }

  const explicitTransportEncryption = wire?.conn?.encrypted;
  if (typeof explicitTransportEncryption === "boolean") {
    return explicitTransportEncryption ? "mse-rc4" : "plaintext";
  }

  const explicitFalseFlags = [wire?.encrypted, wire?.isEncrypted, wire?._encrypted, wire?.peerEncrypted];
  if (explicitFalseFlags.some((value) => value === false)) {
    return "plaintext";
  }

  return "unknown";
};

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

const isResumableStatus = (status: TorrentSessionState["status"]): status is "starting" | "running" | "paused" =>
  status === "starting" || status === "running" || status === "paused";

const normalizeSelectedFileIndices = (indices?: number[]) => {
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

const ensurePersistentSourceForManagedSession = (managedSession: ManagedSession): string | undefined => {
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

const syncResumableSessionRecord = (managedSession: ManagedSession) => {
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
    torrentFilePath,
    selectedFileIndices: normalizeSelectedFileIndices(managedSession.selectedFileIndices),
    status: managedSession.session.status,
    seeding: managedSession.session.seeding,
    createdAt: managedSession.session.createdAt,
    updatedAt: Date.now(),
  };

  upsertResumableSession(record);
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

const getTrackerPool = (sourceTrackers: string[] = []) => {
  const settings = getGlobalSettings();
  // Use trackers from settings, falling back to environment variables, then defaults
  const configuredPrimary = (process.env.TORRENT_TRACKER_URL ?? "").trim();
  return dedupeTrackers([...sourceTrackers, configuredPrimary, ...settings.extraTrackers, ...DEFAULT_TRACKERS]);
};

const getPeersFromTorrent = (torrent: TorrentLike): TrackerPeerDescriptor[] => {
  const wireList: any[] = Array.isArray(torrent?.wires) ? torrent.wires : [];
  const seen = new Set<string>();
  const peers: TrackerPeerDescriptor[] = [];

  for (const wire of wireList) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    const key = `${address.ip}:${address.port}`;
    if (seen.has(`${address.ip}:${resolvedPort}`) || resolvedPort <= 0) {
      continue;
    }

    seen.add(`${address.ip}:${resolvedPort}`);
    peers.push({ ip: address.ip, port: resolvedPort, peerId: wire?.peerId });
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

const collectionSize = (value: unknown): number => {
  if (value instanceof Map || value instanceof Set) {
    return value.size;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }

  return 0;
};

const estimateDiscoveredPeers = (torrent: TorrentLike, activePeers: number): number => {
  const discovery = torrent?.discovery ?? torrent?._discovery;
  const counts = [
    activePeers,
    Number(torrent?.numPeers ?? 0),
    Number(torrent?._numPeers ?? 0),
    collectionSize(torrent?._peers),
    collectionSize(discovery?._peers),
    collectionSize(discovery?.tracker?._peers),
    collectionSize(discovery?.tracker?.client?._peers),
  ].filter((value) => Number.isFinite(value) && value >= 0) as number[];

  if (counts.length === 0) {
    return activePeers;
  }

  return Math.max(...counts);
};

const updatePieceStatesInPlace = (torrent: TorrentLike, states: PieceState[]): PieceState[] => {
  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  const pieceLength = Number(torrent?.pieceLength ?? 0);

  if (piecesTotal <= 0) {
    return [];
  }

  if (states.length !== piecesTotal) {
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
  const pieceUniverse = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);

  // Preserve prior observations so we do not recalculate expensive bitfields every tick.
  const previousByPeer = new Map<string, PeerDownloadState>();
  for (const state of states) {
    previousByPeer.set(`${state.ip}:${state.port}`, state);
  }

  states.length = 0;
  for (const wire of wires) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    const previous = previousByPeer.get(`${address.ip}:${resolvedPort}`);

    const peerPieces = wire?.peerPieces;
    let piecesAvailable = previous?.piecesAvailable ?? 0;
    let piecesAvailableKnown = previous?.piecesAvailableKnown ?? false;

    if (Array.isArray(peerPieces)) {
      piecesAvailable = peerPieces.filter(Boolean).length;
      piecesAvailableKnown = true;
    } else if (peerPieces && typeof peerPieces.get === "function" && pieceUniverse > 0 && !piecesAvailableKnown) {
      let count = 0;
      for (let index = 0; index < pieceUniverse; index += 1) {
        if (peerPieces.get(index)) {
          count += 1;
        }
      }
      piecesAvailable = count;
      piecesAvailableKnown = true;
    }

    if (!piecesAvailableKnown && Number(wire?.downloaded ?? 0) > 0) {
      // Keep unknown, but surface at least one available piece when traffic is active.
      piecesAvailable = Math.max(1, piecesAvailable);
    }

    states.push({
      ip: address.ip,
      port: resolvedPort,
      peerId: wire?.peerId,
      choked: Boolean(wire?.peerChoking),
      piecesAvailable,
      piecesAvailableKnown,
      downloadedBytes: Number(wire?.downloaded ?? 0),
      pendingRequests: Array.isArray(wire?.requests) ? wire.requests.length : 0,
      encryption: inferPeerEncryption(wire),
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
  const turboMode = getGlobalSettings().turboMode;

  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  let piecesCompleted = 0;

  if (piecesTotal > 0) {
    if (turboMode) {
      piecesCompleted = Math.max(0, Math.min(piecesTotal, Math.floor((progress / 100) * piecesTotal)));
    } else if (torrent?.bitfield?.get) {
      for (let index = 0; index < piecesTotal; index += 1) {
        if (torrent.bitfield.get(index)) {
          piecesCompleted += 1;
        }
      }
    }
  }

  const activePeers = Number(Array.isArray(torrent?.wires) ? torrent.wires.length : 0);
  const discoveredPeers = Math.max(activePeers, estimateDiscoveredPeers(torrent, activePeers));
  const remaining = Math.max(0, totalBytes - downloadedBytes);
  const eta = downloadSpeed > 0 ? Math.round(remaining / downloadSpeed) : -1;

  return {
    totalBytes,
    downloadedBytes,
    progress: toFixedOne(progress),
    downloadSpeed,
    uploadSpeed,
    activePeers,
    discoveredPeers,
    piecesCompleted,
    piecesTotal,
    eta,
    downloadSpeedMbps: (downloadSpeed / (1024 * 1024)).toFixed(2),
    etaFormatted: formatEta(eta),
  };
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
  strategy: "sequential" | "random" | "rarest-first"
) => {
  if (!torrent || typeof torrent.select !== "function") {
    return;
  }

  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  if (piecesTotal <= 0) {
    return;
  }

  const start = 0;
  const end = piecesTotal - 1;

  if (strategy !== "sequential") {
    // Remove only our explicit sequential override and keep normal file selections intact.
    if (typeof torrent.deselect === "function") {
      try {
        torrent.deselect(start, end, SEQUENTIAL_SELECTION_PRIORITY);
      } catch {
        // Ignore if the sequential override was never added.
      }
    }
    return;
  }

  torrent.select(start, end, SEQUENTIAL_SELECTION_PRIORITY);
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
  const sparseSwarm = peers > 0 && peers < 20;
  const verySparseSwarm = peers > 0 && peers < 10;

  let targetMaxRequests = 24;
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

  // Respect hard safety guard caps if enabled.
  const maxRequestsCap = DISK_SAFETY_GUARD.enabled ? DISK_SAFETY_GUARD.maxRequestsPerPeer : 64;
  targetMaxRequests = Math.max(10, Math.min(maxRequestsCap, targetMaxRequests));

  const targetStrategy: "sequential" | "random" | "rarest-first" =
    sparseSwarm || speedMbps < 1.5 || (progress < 20 && speedMbps < 4) ? "sequential" : "rarest-first";

  const torrentRef = managedSession.torrent as any;
  let changed = false;

  if (managedSession.adaptiveMaxRequests !== targetMaxRequests) {
    managedSession.adaptiveMaxRequests = targetMaxRequests;
    torrentRef.maxRequests = targetMaxRequests;
    changed = true;
  }

  if (managedSession.adaptiveStrategy !== targetStrategy) {
    managedSession.adaptiveStrategy = targetStrategy;
    applyPieceSelectionStrategy(managedSession.torrent, targetStrategy);
    changed = true;
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

  managedSession.latestFilePath = getFilePathForDownload(managedSession.session.sessionId, torrent);

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
    clientRef.uploadLimit = undefined;
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

// Helper: direct decode of torrent files bypassing WebTorrent
const decodeTorrentFiles = (buffer: Buffer): TorrentFileInfo[] => {
  try {
    const decoded = bencode.decode(buffer);
    const info = decoded.info;
    if (!info) throw new Error("No info dictionary found in torrent file");

    // Single file torrent
    if (!info.files) {
      const length = Number(info.length || 0);
      const nameList = Array.isArray(info.name) 
        ? info.name.map((b: Buffer) => b.toString("utf8"))
        : [info.name ? info.name.toString("utf8") : "download.bin"];
      
      const fileName = nameList[0] || "download.bin";
      return [{
        index: 0,
        name: fileName,
        path: fileName,
        length,
        selected: true,
      }];
    }

    // Multi-file torrent
    const files = info.files;
    const baseName = info.name ? info.name.toString("utf8") : "download";
    
    return files.map((fileObj: any, idx: number) => {
      let pathSegments: string[] = [];
      if (Array.isArray(fileObj.path)) {
        pathSegments = fileObj.path.map((b: Buffer) => b.toString("utf8"));
      }
      
      const filePath = [baseName, ...pathSegments].join("/");
      const fileName = pathSegments[pathSegments.length - 1] || `${baseName}-file-${idx}`;

      return {
        index: idx,
        name: fileName,
        path: filePath,
        length: Number(fileObj.length || 0),
        selected: true,
      };
    });
  } catch (error) {
    logger.error("[decodeTorrentFiles] Error decoding torrent file:", error);
    throw error;
  }
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
    if (Buffer.isBuffer(source)) {
      managedSession.sourceTorrentFilePath = persistSessionSourceTorrent(sessionId, fallbackName, source);
    } else if (typeof source === "string" && fs.existsSync(source)) {
      managedSession.sourceTorrentFilePath = source;
    }
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

const buildRestoreSourceOptions = (
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

  const sourceBuffer = record.torrentFilePath ? loadSessionSourceTorrent(record.torrentFilePath) : null;
  if (!sourceBuffer) {
    return null;
  }

  return {
    input: sourceBuffer,
  };
};

export const restorePersistedTorrentsOnBoot = async (): Promise<AutoResumeSummary> => {
  if (process.env.AUTO_RESUME_ON_BOOT === "false") {
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
      failed += 1;
      logger.error(
        `[AutoResume] Failed to restore ${record.sessionId}:`,
        error instanceof Error ? error.message : String(error)
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

