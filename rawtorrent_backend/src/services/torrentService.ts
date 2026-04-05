import fs from "node:fs";
import path from "node:path";
import WebTorrent from "webtorrent";
import bencode from "bencode";
import type { StartTorrentOptions, TorrentSessionState, TrackerPeerDescriptor, TorrentFileInfo } from "../types/torrent";
import { publishEvent } from "../redis/publisher";
import { appendSessionEvent, listSessionsByUser, loadSession, persistSession } from "./persistenceService";
import { ensureSessionStorage, getSessionStoragePaths, writeDownloadMetadata } from "./fileStorageService";
import { getGlobalSettings } from "../settings";

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
  piecesAvailableKnown: boolean;
  downloadedBytes: number;
  pendingRequests: number;
  encryption: "unknown" | "plaintext" | "mse-rc4";
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
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.publicbt.com:80/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://9.rarbg.to:2710/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.opentrackr.org:443/announce",
  "udp://tracker.1337x.com:6969/announce",
  "udp://tracker.zer0day.to:1337/announce",
];

export const torrentSessions = sessions;

const client = new WebTorrent({
  dht: true,
  tracker: true,
  maxConns: 300, // Global connection pool - individual torrents will respect their per-session limits via settings
  downloadLimit: 0, // No global download limit
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
  const settings = getGlobalSettings();
  // Use trackers from settings, falling back to environment variables, then defaults
  const configuredPrimary = (process.env.TORRENT_TRACKER_URL ?? "").trim();
  const allTrackers = Array.from(new Set([configuredPrimary, ...settings.extraTrackers, ...DEFAULT_TRACKERS].filter(Boolean)));
  return allTrackers;
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
  
  // Resize if needed (unlikely to need shrink unless peers dropped, but we map fresh to be safe if count changes vastly)
  // Instead of fully rebuilding, just map fresh. It's only ~100 objects maximum normally.
  states.length = 0;
  for (const wire of wires) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    const peerPieces = wire?.peerPieces;
    let piecesAvailable = 0;
    let piecesAvailableKnown = false;

    if (Array.isArray(peerPieces)) {
      piecesAvailable = peerPieces.filter(Boolean).length;
      piecesAvailableKnown = true;
    } else if (peerPieces && typeof peerPieces.get === "function" && pieceUniverse > 0) {
      let count = 0;
      for (let index = 0; index < pieceUniverse; index += 1) {
        if (peerPieces.get(index)) {
          count += 1;
        }
      }
      piecesAvailable = count;
      piecesAvailableKnown = true;
    } else if (typeof peerPieces?.length === "number" && peerPieces.length > 0) {
      piecesAvailable = Number(peerPieces.length);
      piecesAvailableKnown = true;
    }

    if (!piecesAvailableKnown && Number(wire?.downloaded ?? 0) > 0) {
      piecesAvailableKnown = false;
      piecesAvailable = 0;
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

  const previousCompleted = new Set(managedSession.session.completedPieces ?? []);

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

  const newlyVerifiedPieces = managedSession.session.completedPieces.filter((pieceIndex) => !previousCompleted.has(pieceIndex));
  
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

    wire.on("request", (pieceIndex: number, offset: number, length: number) => {
      fire("block_requested", {
        ip: address.ip,
        port: resolvedPort,
        peerId: wire?.peerId,
        peerLabel,
        pieceIndex,
        offset,
        length,
      });
    });

    wire.on("piece", (pieceIndex: number, offset: number, buffer: Buffer) => {
      fire("block_received", {
        ip: address.ip,
        port: resolvedPort,
        peerId: wire?.peerId,
        peerLabel,
        pieceIndex,
        offset,
        bytes: Number(buffer?.length ?? 0),
      });
    });

    wire.on("have", (pieceIndex: number) => {
      fire("peer_have_piece", {
        ip: address.ip,
        port: resolvedPort,
        peerId: wire?.peerId,
        peerLabel,
        pieceIndex,
        peers: Number(Array.isArray(torrent?.wires) ? torrent.wires.length : 0),
      });
    });

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

  const settings = getGlobalSettings();
  const announcePool = getTrackerPool();
  
  const torrent = client.add(managedSession.source, {
    path: storage.sessionDir,
    announce: announcePool,
    destroyStoreOnDestroy: false,
    // Apply user settings to this torrent
    maxRequests: settings.maxRequestsPerPeer,
  });

  managedSession.torrent = torrent;
  bindTorrentEvents(managedSession);

  // Apply piece selection strategy (if supported by WebTorrent version)
  try {
    if (settings.pieceSelectionStrategy === "sequential") {
      // Sequential: Request pieces in order (fastest start, good for streaming)
      if (torrent && typeof torrent.select === "function") {
        const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
        if (piecesTotal > 0) {
          // Select all pieces sequentially (don't deselect any)
          for (let i = 0; i < piecesTotal; i++) {
            torrent.select(i, false, true); // (index, priority, notify)
          }
          console.log(`[${managedSession.session.sessionId}] Applied SEQUENTIAL piece selection strategy`);
        }
      }
    } else if (settings.pieceSelectionStrategy === "rarest-first") {
      // Rarest-first: Request scarcest pieces first (balances the swarm, better for health)
      console.log(`[${managedSession.session.sessionId}] Using RAREST-FIRST piece selection strategy (default)`);
    } else {
      console.log(`[${managedSession.session.sessionId}] Using RANDOM piece selection strategy`);
    }
  } catch (err) {
    console.warn(`[${managedSession.session.sessionId}] Could not apply piece strategy:`, err instanceof Error ? err.message : err);
  }

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
    console.error("[decodeTorrentFiles] Error decoding torrent file:", error);
    throw error;
  }
};

// Parse torrent metadata and extract file list without starting download
export const parseTorrent = async (options: StartTorrentOptions): Promise<TorrentFileInfo[]> => {
  const { source, sourceType } = getSourceAndType(options);
  
  // For .torrent files, decode directly to bypass WebTorrent's unreliability with `torrent.files` sync
  if (sourceType === "torrent-file" && Buffer.isBuffer(source)) {
    console.log("[parseTorrent] Extracting files via bencode directly...");
    return decodeTorrentFiles(source);
  }
  
  // For magnet links, we must use WebTorrent to fetch the metadata from peers
  console.log("[parseTorrent] Attempting to parse magnet link via WebTorrent temp client...");
  // Create a temporary client just for parsing
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
          tempClient.destroy((err?: Error) => {
            if (err) console.error("[parseTorrent] Cleanup error:", err);
          });
        }
      } catch (err) {
        console.error("[parseTorrent] Cleanup exception:", err);
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
    seeding: false,
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

  // Handle file selection: explicitly select/deselect files
  const files: any[] = Array.isArray(torrent?.files) ? torrent.files : [];
  if (options.selectedFileIndices && Array.isArray(options.selectedFileIndices)) {
    // Deselect unselected files
    const selectedSet = new Set(options.selectedFileIndices);
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
    isDownloading: session.status === "running" && Boolean(managedSession?.torrent),
    peerCount: progress?.activePeers ?? session.peers.length,
    activePeerCount: progress?.activePeers ?? 0,
  };
};

export const setSeedingEnabled = async (sessionId: string, enabled: boolean): Promise<boolean> => {
  const managedSession = managed.get(sessionId);
  if (!managedSession) {
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
