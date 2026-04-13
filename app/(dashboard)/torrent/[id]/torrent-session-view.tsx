"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PieceGrid from "@/components/piece-grid";
import PeerGraph, { type GraphPeer } from "@/components/peer-graph";
import { BackendEvent, getBackendHttpUrl, getBackendWsUrl } from "@/lib/backend";
import { upsertCachedSession } from "@/lib/session-cache";

type SessionPayload = {
  sessionId: string;
  fileName: string;
  infoHash: string;
  trackerUrl: string;
  peers: Array<{ ip: string; port: number; peerId?: string }>;
  pieceCount: number;
  progress: number;
  status: "idle" | "starting" | "running" | "paused" | "completed" | "error";
};

type RuntimeSettings = {
  turboMode?: boolean;
  [key: string]: unknown;
};

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

type EventPhase = "system" | "discovery" | "handshake" | "transfer" | "verification" | "error";

type EventLine = {
  id: string;
  timestamp: number;
  type: string;
  phase: EventPhase;
  level: "normal" | "warn" | "error";
  summary: string;
  peerKey?: string;
};

type ProtocolTag = "handshake" | "bitfield" | "interested" | "unchoke" | "request" | "piece" | "verify" | "have" | "error" | "info";

const IMPORTANT_EVENT_TYPES = new Set([
  "torrent_started",
  "torrent_paused",
  "torrent_resumed",
  "torrent_completed",
  "torrent_error",
  "peer_handshake",
  "peer_bitfield",
  "peer_interested",
  "peer_discovered",
  "peer_choked",
  "peer_unchoked",
  "block_requested",
  "piece_batch_received",
  "peer_have_piece",
  "piece_verified",
  "piece_failed",
]);

const STAGE_LABELS = ["discovered", "handshake", "unchoked", "requesting", "verified"] as const;

const peerAddressKey = (peer: Pick<PeerDownloadState, "ip" | "port">) => `${peer.ip}:${peer.port}`;

const peerSelectionKey = (peer: Pick<PeerDownloadState, "ip" | "port">) => peerAddressKey(peer);

const peerDisplayLabel = (peer: Pick<PeerDownloadState, "ip" | "port" | "peerId">) =>
  peer.peerId ? `${peer.peerId} (${peer.ip}:${peer.port})` : peerAddressKey(peer);

const resolvePeerStage = (
  peer: PeerDownloadState,
  eventStage: number | undefined,
): 0 | 1 | 2 | 3 | 4 => {
  const fromEvents = typeof eventStage === "number" ? eventStage : -1;
  const fromState =
    peer.downloadedBytes > 0
      ? 4
      : peer.pendingRequests > 0
        ? 3
        : !peer.choked
          ? 2
          : 0;

  return Math.min(4, Math.max(fromEvents, fromState)) as 0 | 1 | 2 | 3 | 4;
};

const toEventPhase = (type: string): EventPhase => {
  if (type.includes("error") || type.includes("failed")) return "error";
  if (type.includes("verify") || type.includes("piece_verified")) return "verification";
  if (type.includes("handshake") || type.includes("choke") || type.includes("unchoke")) return "handshake";
  if (type.includes("peer") || type.includes("discover")) return "discovery";
  if (type.includes("progress") || type.includes("request") || type.includes("block") || type.includes("download")) return "transfer";
  return "system";
};

const eventLevel = (type: string): "normal" | "warn" | "error" => {
  if (type.includes("error") || type.includes("failed")) return "error";
  if (type.includes("paused") || type.includes("stopped")) return "warn";
  return "normal";
};

const resolvePeerKey = (event: BackendEvent): string | undefined => {
  const data = event.data as { ip?: string; port?: number; peerId?: string };
  if (data.peerId) return data.peerId;
  if (data.ip && typeof data.port === "number") return `${data.ip}:${data.port}`;
  return undefined;
};

const summarizeEvent = (event: BackendEvent): string => {
  const data = event.data as Record<string, unknown>;
  const pieces = typeof data.pieceIndex === "number" ? `piece #${data.pieceIndex}` : null;
  const pieceIndex = typeof data.pieceIndex === "number" ? data.pieceIndex : null;
  const offset = typeof data.offset === "number" ? data.offset : 0;
  const length = typeof data.length === "number" ? data.length : 0;
  const bytes = typeof data.bytes === "number" ? data.bytes : 0;
  const ip = typeof data.ip === "string" ? data.ip : null;
  const port = typeof data.port === "number" ? `:${data.port}` : "";
  const speed = typeof data.downloadSpeed === "number" ? `speed ${(data.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s` : null;
  const peerLabel = typeof data.peerLabel === "string" ? data.peerLabel : null;
  const peer = peerLabel ?? (ip ? `${ip}${port}` : "peer");
  const piecesAvailable = typeof data.piecesAvailable === "number" ? data.piecesAvailable : null;
  const peers = typeof data.peers === "number" ? data.peers : null;

  if (event.type === "peer_handshake") return `${peer} connected via TCP/${String(data.port ?? "?")}`;
  if (event.type === "peer_bitfield" && piecesAvailable !== null) return `received ${piecesAvailable} pieces from ${peer}`;
  if (event.type === "peer_interested") return `sent to ${peer}`;
  if (event.type === "peer_unchoked") return `received from ${peer}`;
  if (event.type === "block_requested" && pieceIndex !== null) return `piece idx=${pieceIndex} offset=${offset} len=${length}`;
  if (event.type === "block_received") return `received ${bytes} bytes from ${peer}`;
  if (event.type === "piece_batch_received") {
    const blocks = typeof data.blocks === "number" ? data.blocks : 0;
    const peersCount = typeof data.peers === "number" ? data.peers : 0;
    const bytesCount = typeof data.bytes === "number" ? data.bytes : 0;
    return `received ${blocks} blocks (${formatBytes(bytesCount)}) from ${peersCount} peers`;
  }
  if (event.type === "piece_verified" && pieceIndex !== null) return `sha1 hash OK for piece ${pieceIndex}`;
  if (event.type === "peer_have_piece" && pieceIndex !== null) return `broadcast piece ${pieceIndex} to ${peers ?? "?"} peers`;

  if (event.type === "peer_discovered" && ip) return `Peer discovered ${ip}${port}`;
  if (event.type === "peer_unchoked" && ip) return `Peer unchoked ${ip}${port}`;
  if (event.type === "peer_choked" && ip) return `Peer choked ${ip}${port}`;
  if (event.type === "block_requested" && pieces) return `Requested ${pieces}`;
  if (event.type === "piece_verified" && pieces) return `Verified ${pieces}`;
  if (event.type === "download_progress" && speed) return `Transfer update ${speed}`;

  const fields = Object.entries(data)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return fields || event.type.replaceAll("_", " ");
};

const protocolTagForEvent = (line: EventLine): ProtocolTag => {
  const type = line.type.toLowerCase();
  const summary = line.summary.toLowerCase();

  if (line.level === "error" || type.includes("error") || type.includes("failed")) return "error";
  if (type.includes("handshake")) return "handshake";
  if (type.includes("bitfield")) return "bitfield";
  if (type.includes("interested")) return "interested";
  if (type.includes("unchoke") || type.includes("choke")) return "unchoke";
  if (type.includes("block_requested") || type.includes("piece_requested") || summary.includes("requested")) return "request";
  if (type.includes("block_received") || summary.includes("received")) return "piece";
  if (type.includes("piece_verified") || type.includes("verify") || summary.includes("verified")) return "verify";
  if (type.includes("have") || type.includes("peer_has_piece")) return "have";
  return "info";
};

const protocolTagClass: Record<ProtocolTag, string> = {
  handshake: "text-primary",
  bitfield: "text-accent",
  interested: "text-foreground/80",
  unchoke: "text-primary",
  request: "text-orange-500",
  piece: "text-foreground/80",
  verify: "text-green-600",
  have: "text-primary",
  error: "text-destructive",
  info: "text-foreground/70",
};

const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let speed = bytesPerSecond;
  let unit = 0;
  while (speed >= 1024 && unit < units.length - 1) {
    speed /= 1024;
    unit += 1;
  }
  return `${speed.toFixed(1)} ${units[unit]}`;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
};

const formatMegabytes = (bytes: number): string => {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const mb = safeBytes / (1024 * 1024);
  return `${mb.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
};

const formatEtaLabel = (etaSeconds: number, isComplete: boolean): string => {
  if (isComplete) return "done";
  if (!Number.isFinite(etaSeconds) || etaSeconds < 0) return "calculating...";

  if (etaSeconds < 60) {
    return `${Math.max(1, Math.round(etaSeconds))}s`;
  }

  if (etaSeconds < 3600) {
    const mins = Math.floor(etaSeconds / 60);
    const secs = Math.floor(etaSeconds % 60);
    return `${mins}m ${secs}s`;
  }

  const hours = Math.floor(etaSeconds / 3600);
  const mins = Math.floor((etaSeconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", { hour12: false });

function LoadingBlock({ className }: { className: string }) {
  return <div className={`rounded-lg silver-shimmer ${className}`} />;
}

function InitialTorrentSkeleton() {
  return (
    <>
      <section className="animate-fade-in-up delay-100 grid gap-4 grid-cols-2 lg:grid-cols-6">
        <div className="col-span-2 rounded-xl border bg-card p-5 space-y-3">
          <LoadingBlock className="h-3 w-24" />
          <LoadingBlock className="h-8 w-28" />
          <LoadingBlock className="h-4 w-40" />
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <LoadingBlock className="h-3 w-28" />
          <LoadingBlock className="h-8 w-20" />
          <LoadingBlock className="h-3 w-36" />
        </div>
        <div className="col-span-3 rounded-xl border bg-card p-5 space-y-3">
          <LoadingBlock className="h-3 w-36" />
          <LoadingBlock className="h-2 w-full" />
          <LoadingBlock className="h-3 w-28 ml-auto" />
        </div>
      </section>

      <section className="animate-fade-in-up delay-150 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`phase-skeleton-${index}`} className="rounded-lg border bg-card px-3 py-2 space-y-2">
            <LoadingBlock className="h-3 w-20" />
            <LoadingBlock className="h-6 w-10" />
          </div>
        ))}
      </section>

      <section className="animate-fade-in-up delay-175 rounded-xl border bg-card p-4">
        <LoadingBlock className="h-4 w-40 mb-3" />
        <div className="grid grid-cols-12 gap-1">
          {Array.from({ length: 96 }).map((_, index) => (
            <LoadingBlock key={`piece-skeleton-${index}`} className="h-2.5 w-full rounded-sm" />
          ))}
        </div>
      </section>

      <section className="animate-fade-in-up delay-200 grid xl:grid-cols-[2fr_1fr] gap-5">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <LoadingBlock className="h-4 w-52" />
          <LoadingBlock className="h-[300px] w-full" />
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <LoadingBlock className="h-4 w-32 mb-2" />
          {Array.from({ length: 5 }).map((_, index) => (
            <LoadingBlock key={`lane-skeleton-${index}`} className="h-14 w-full" />
          ))}
        </div>
      </section>

      <section className="animate-fade-in-up delay-300 grid lg:grid-cols-2 gap-10">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <LoadingBlock className="h-4 w-32" />
          <LoadingBlock className="h-28 w-full" />
          <LoadingBlock className="h-28 w-full" />
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <LoadingBlock className="h-4 w-48" />
          <LoadingBlock className="h-[340px] w-full" />
        </div>
      </section>
    </>
  );
}

export default function TorrentSessionView({
  sessionId,
}: {
  sessionId: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [peerStates, setPeerStates] = useState<PeerDownloadState[]>([]);
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [eventLines, setEventLines] = useState<EventLine[]>([]);
  const [authToken, setAuthToken] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isControlPending, setIsControlPending] = useState(false);
  const [isDownloadPending, setIsDownloadPending] = useState(false);
  const [completionNotified, setCompletionNotified] = useState(false);
  const [isSessionHydrated, setIsSessionHydrated] = useState(false);
  const [isMetricsHydrated, setIsMetricsHydrated] = useState(false);
  const [eventStreamPaused, setEventStreamPaused] = useState(false);
  const [pausedEventLines, setPausedEventLines] = useState<EventLine[]>([]);
  const [eventSearchText, setEventSearchText] = useState("");
  const [eventPhaseFilter, setEventPhaseFilter] = useState<"all" | EventPhase>("all");
  const [eventMode, setEventMode] = useState<"all" | "important" | "errors">("important");
  const [eventViewMode, setEventViewMode] = useState<"timeline" | "log">("log");
  const [eventLimit, setEventLimit] = useState(60);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [isTurboMode, setIsTurboMode] = useState(false);
  const [isTurboTogglePending, setIsTurboTogglePending] = useState(false);
  const [hasAutoSwitchedSession, setHasAutoSwitchedSession] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showSeedingModal, setShowSeedingModal] = useState(false);
  const [isSeedingTogglePending, setIsSeedingTogglePending] = useState(false);
  const blockBatchRef = useRef<{ blocks: number; bytes: number; peers: Set<string> }>({
    blocks: 0,
    bytes: 0,
    peers: new Set<string>(),
  });

  const pushEventLine = useCallback((next: EventLine) => {
    setEventLines((current) => [...current, next].slice(-320));
  }, []);

  const handleToggleEventStreamPause = useCallback(() => {
    setEventStreamPaused((current) => {
      if (current) {
        setPausedEventLines([]);
        return false;
      }

      setPausedEventLines(eventLines);
      return true;
    });
  }, [eventLines]);

  useEffect(() => {
    setAuthToken("local-bypass");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRuntimeSettings = async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as RuntimeSettings;
        if (!cancelled && typeof payload.turboMode === "boolean") {
          setIsTurboMode(payload.turboMode);
        }
      } catch {
        // no-op
      }
    };

    void loadRuntimeSettings();
    const refreshTimer = setInterval(() => {
      void loadRuntimeSettings();
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, []);

  const fetchProgress = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/progress`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: DownloadProgress };
      if (payload.data) setDownloadProgress(payload.data);
    } catch {
      // no-op
    }
  }, [sessionId, authToken]);

  const fetchPeers = useCallback(async () => {
    if (!authToken || isTurboMode) return;
    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/peers`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: PeerDownloadState[] };
      if (payload.data) setPeerStates(payload.data);
    } catch {
      // no-op
    }
  }, [sessionId, authToken, isTurboMode]);

  const fetchPieces = useCallback(async () => {
    if (!authToken || isTurboMode) return;
    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/pieces`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: PieceState[] };
      if (payload.data) setPieces(payload.data);
    } catch {
      // no-op
    }
  }, [sessionId, authToken, isTurboMode]);

  const hydrateInitialMetrics = useCallback(async () => {
    if (!authToken) return;
    if (isTurboMode) {
      await fetchProgress();
      setIsMetricsHydrated(true);
      return;
    }

    await Promise.all([fetchProgress(), fetchPeers(), fetchPieces()]);
    setIsMetricsHydrated(true);
  }, [authToken, fetchProgress, fetchPeers, fetchPieces, isTurboMode]);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      setError(null);
      try {
        const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}`, {
          headers: { Authorization: "Bearer local-bypass" },
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: string;
          data?: SessionPayload;
        };

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "Unable to load session");
        }

        const sessionData = payload.data;
        if (!cancelled) {
          setSession(sessionData);
          pushEventLine({
            id: `load-${Date.now()}`,
            timestamp: Date.now(),
            type: "session_loaded",
            phase: "system",
            level: "normal",
            summary: `Loaded ${sessionData.fileName}`,
          });
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "Failed to load session");
        }
      } finally {
        if (!cancelled) {
          setIsSessionHydrated(true);
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId, pushEventLine]);

  useEffect(() => {
    if (!authToken) return;

    setIsMetricsHydrated(false);

    void hydrateInitialMetrics();

    const progressTimer = setInterval(fetchProgress, isTurboMode ? 2000 : 1500);
    const peerTimer = isTurboMode ? null : setInterval(fetchPeers, 3500);
    const pieceTimer = isTurboMode ? null : setInterval(fetchPieces, 4500);

    return () => {
      clearInterval(progressTimer);
      if (peerTimer) clearInterval(peerTimer);
      if (pieceTimer) clearInterval(pieceTimer);
    };
  }, [authToken, fetchProgress, fetchPeers, fetchPieces, hydrateInitialMetrics, isTurboMode]);

  useEffect(() => {
    if (!authToken || !session || hasAutoSwitchedSession || isTurboMode) return;

    const currentProgress = downloadProgress?.progress ?? session.progress ?? 0;
    const noPeerActivity = peerStates.length === 0;
    const looksStaleRunning = session.status === "running" && currentProgress <= 0.1 && noPeerActivity;
    if (!looksStaleRunning) return;

    let cancelled = false;

    const trySwitchToActiveSibling = async () => {
      try {
        const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { data?: Array<SessionPayload> };
        const sessions = payload.data ?? [];

        const sibling = sessions.find((candidate) => {
          if (candidate.sessionId === session.sessionId) return false;
          if (candidate.status !== "running") return false;

          const sameTorrent =
            (session.infoHash !== "pending" && candidate.infoHash === session.infoHash) ||
            candidate.fileName === session.fileName;

          return sameTorrent && candidate.progress > currentProgress + 0.5;
        });

        if (!cancelled && sibling) {
          setHasAutoSwitchedSession(true);
          setError(`Switched to active session ${sibling.sessionId}`);
          router.replace(`/torrent/${sibling.sessionId}`);
        }
      } catch {
        // no-op
      }
    };

    void trySwitchToActiveSibling();

    return () => {
      cancelled = true;
    };
  }, [authToken, session, downloadProgress?.progress, peerStates.length, hasAutoSwitchedSession, router, isTurboMode]);

  useEffect(() => {
    if (!authToken || isTurboMode) return;

    const socket = new WebSocket(`${getBackendWsUrl()}/ws`);

    const flushBatch = () => {
      const batch = blockBatchRef.current;
      if (batch.blocks <= 0) return;

      pushEventLine({
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        type: "piece_batch_received",
        phase: "transfer",
        level: "normal",
        summary: `received ${batch.blocks} blocks (${formatBytes(batch.bytes)}) from ${batch.peers.size} peers`,
      });

      blockBatchRef.current = { blocks: 0, bytes: 0, peers: new Set<string>() };
    };

    const batchTimer = setInterval(flushBatch, 1400);

    socket.onmessage = (rawMessage) => {
      try {
        const event = JSON.parse(rawMessage.data as string) as BackendEvent;
        if (event.sessionId && event.sessionId !== sessionId) return;

        if (event.type === "block_received") {
          const data = event.data as { bytes?: number };
          const peerKey = resolvePeerKey(event);

          blockBatchRef.current.blocks += 1;
          blockBatchRef.current.bytes += Number(data.bytes ?? 0);
          if (peerKey) {
            blockBatchRef.current.peers.add(peerKey);
          }
          return;
        }

        pushEventLine({
          id: `${event.timestamp}-${event.type}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: event.timestamp,
          type: event.type,
          phase: toEventPhase(event.type),
          level: eventLevel(event.type),
          summary: summarizeEvent(event),
          peerKey: resolvePeerKey(event),
        });

        if (event.type === "torrent_progress") {
          const data = event.data as { progress?: number };
          if (typeof data.progress === "number") {
            const nextProgress = data.progress;
            setSession((current) => (current ? { ...current, progress: nextProgress } : current));
          }
        }

        if (event.type === "download_progress") {
          const data = event.data as DownloadProgress;
          setDownloadProgress(data);
        }

        if (event.type === "peer_discovered") {
          void fetchPeers();
        }

        if (event.type === "piece_verified" || event.type === "torrent_completed") {
          void fetchPieces();
          if (event.type === "torrent_completed") {
            setSession((current) => (current ? { ...current, status: "completed", progress: 100 } : current));
          }
        }
      } catch {
        pushEventLine({
          id: `ws-parse-${Date.now()}`,
          timestamp: Date.now(),
          type: "ws_error",
          phase: "error",
          level: "error",
          summary: "Invalid websocket payload",
        });
      }
    };

    socket.onerror = () => {
      pushEventLine({
        id: `ws-error-${Date.now()}`,
        timestamp: Date.now(),
        type: "ws_error",
        phase: "error",
        level: "error",
        summary: "Unable to stream events",
      });
    };

    return () => {
      clearInterval(batchTimer);
      flushBatch();

      // In React dev lifecycle, teardown can happen before the handshake finishes.
      // Avoid closing while CONNECTING to prevent noisy browser errors.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener(
          "open",
          () => {
            socket.close();
          },
          { once: true }
        );
        return;
      }

      socket.close();
    };
  }, [authToken, sessionId, fetchPeers, fetchPieces, pushEventLine, isTurboMode]);

  const isRunning = session?.status === "running";
  const progress = downloadProgress?.progress ?? session?.progress ?? 0;
  const isComplete = session?.status === "completed" || progress >= 99.9;
  const hasDownloadStarted =
    (downloadProgress?.downloadedBytes ?? 0) > 0 ||
    (downloadProgress?.activePeers ?? 0) > 0 ||
    peerStates.some((peer) => peer.downloadedBytes > 0 || peer.pendingRequests > 0) ||
    (session?.progress ?? 0) > 0;
  const isInitialLoading = !isSessionHydrated || !isMetricsHydrated || (!isComplete && !hasDownloadStarted);
  const fileName = session?.fileName ?? `Session ${sessionId}`;
  const pieceTotal = downloadProgress?.piecesTotal ?? session?.pieceCount ?? pieces.length;
  const totalBytes = downloadProgress?.totalBytes ?? 0;
  const downloadedBytes =
    downloadProgress?.downloadedBytes ??
    (totalBytes > 0 ? Math.round((Math.max(0, Math.min(100, progress)) / 100) * totalBytes) : 0);
  const completedMbLabel = formatMegabytes(downloadedBytes);
  const totalMbLabel = totalBytes > 0 ? formatMegabytes(totalBytes) : "-- MB";
  const etaLabel = formatEtaLabel(downloadProgress?.eta ?? -1, isComplete);
  const activePeerCount = downloadProgress?.activePeers ?? 0;
  const discoveredPeerCount = Math.max(activePeerCount, downloadProgress?.discoveredPeers ?? 0);

  const mappedPeers = useMemo<PeerDownloadState[]>(() => {
    if (isTurboMode) return [];
    if (peerStates.length > 0) return peerStates;
    return (
      session?.peers.map((peer) => ({
        ip: peer.ip,
        port: peer.port,
        peerId: peer.peerId,
        choked: false,
        piecesAvailable: 0,
        piecesAvailableKnown: false,
        downloadedBytes: 0,
        pendingRequests: 0,
        encryption: "unknown",
      })) ?? []
    );
  }, [peerStates, session?.peers, isTurboMode]);

  const uniquePeers = useMemo<PeerDownloadState[]>(() => {
    if (isTurboMode) return [];
    const byAddress = new Map<string, PeerDownloadState>();

    for (const peer of mappedPeers) {
      const key = peerAddressKey(peer);
      const existing = byAddress.get(key);

      if (!existing) {
        byAddress.set(key, peer);
        continue;
      }

      byAddress.set(key, {
        ...existing,
        peerId: existing.peerId ?? peer.peerId,
        choked: existing.choked && peer.choked,
        piecesAvailable: Math.max(existing.piecesAvailable, peer.piecesAvailable),
        piecesAvailableKnown: existing.piecesAvailableKnown || peer.piecesAvailableKnown,
        downloadedBytes: Math.max(existing.downloadedBytes, peer.downloadedBytes),
        pendingRequests: Math.max(existing.pendingRequests, peer.pendingRequests),
        encryption: existing.encryption !== "unknown" ? existing.encryption : peer.encryption,
      });
    }

    return Array.from(byAddress.values());
  }, [mappedPeers, isTurboMode]);

  useEffect(() => {
    if (!session) {
      return;
    }

    upsertCachedSession({
      sessionId: session.sessionId,
      fileName: session.fileName ?? `Session ${session.sessionId}`,
      status: session.status,
      progress,
      peers: uniquePeers.slice(0, 120).map((peer) => ({
        ip: peer.ip,
        port: peer.port,
        peerId: peer.peerId,
      })),
    });
  }, [session, progress, uniquePeers]);

  const trackers = useMemo(() => {
    if (!session?.trackerUrl) return 0;
    return session.trackerUrl.split(",").filter((item) => item.trim().length > 0).length;
  }, [session?.trackerUrl]);

  const health = useMemo(() => {
    const active = uniquePeers.filter((peer) => !peer.choked).length;
    const choked = uniquePeers.length - active;
    return { active, choked };
  }, [uniquePeers]);

  const swarmPressure = useMemo(() => {
    const pending = uniquePeers.reduce((sum, peer) => sum + peer.pendingRequests, 0);
    const avgPending = uniquePeers.length ? pending / uniquePeers.length : 0;
    const activeWithRequests = uniquePeers.filter((peer) => peer.pendingRequests > 0).length;
    return { pending, avgPending, activeWithRequests };
  }, [uniquePeers]);

  const recentByPeer = useMemo(() => {
    if (isTurboMode) return new Map<string, number>();
    const recent = eventLines.slice(-240);
    const stages = new Map<string, number>();

    for (const line of recent) {
      if (!line.peerKey) continue;
      if (line.type.includes("piece_verified")) stages.set(line.peerKey, 4);
      else if (line.type.includes("block_requested")) stages.set(line.peerKey, Math.max(stages.get(line.peerKey) ?? 0, 3));
      else if (line.type.includes("unchoke")) stages.set(line.peerKey, Math.max(stages.get(line.peerKey) ?? 0, 2));
      else if (line.type.includes("handshake")) stages.set(line.peerKey, Math.max(stages.get(line.peerKey) ?? 0, 1));
      else if (line.type.includes("peer_discovered")) stages.set(line.peerKey, Math.max(stages.get(line.peerKey) ?? 0, 0));
    }

    return stages;
  }, [eventLines, isTurboMode]);

  const graphPeers = useMemo<GraphPeer[]>(() => {
    if (isTurboMode) return [];
    return uniquePeers.slice(0, 120).map((peer) => {
      const addressKey = peerAddressKey(peer);
      const eventStage = (peer.peerId ? recentByPeer.get(peer.peerId) : undefined) ?? recentByPeer.get(addressKey);
      const activity = Math.min(1, (peer.pendingRequests + peer.piecesAvailable / 64 + (peer.downloadedBytes > 0 ? 1 : 0)) / 6);
      const stage = resolvePeerStage(peer, eventStage);
      return {
        id: peerSelectionKey(peer),
        label: peerDisplayLabel(peer),
        stage,
        activity,
        downloadLabel: `${formatBytes(peer.downloadedBytes)}`,
        uploadLabel: `${peer.pendingRequests} req`,
        pendingRequests: peer.pendingRequests,
        piecesAvailable: peer.piecesAvailable,
      };
    });
  }, [uniquePeers, recentByPeer, isTurboMode]);

  const peersTable = useMemo(
    () => [...uniquePeers].sort((a, b) => b.downloadedBytes - a.downloadedBytes),
    [uniquePeers]
  );

  const topPeers = useMemo(() => peersTable.slice(0, 24), [peersTable]);

  const verifiedPeers = useMemo(
    () => graphPeers.filter((peer) => peer.stage >= 4).length,
    [graphPeers]
  );

  const activeRequestPeers = useMemo(
    () => uniquePeers.filter((peer) => peer.pendingRequests > 0).length,
    [uniquePeers]
  );

  const totalDownloadedByPeers = useMemo(
    () => uniquePeers.reduce((sum, peer) => sum + peer.downloadedBytes, 0),
    [uniquePeers]
  );

  const topContributors = useMemo(
    () => peersTable.filter((peer) => peer.downloadedBytes > 0).slice(0, 8),
    [peersTable]
  );

  const requestHotspots = useMemo(
    () => peersTable.filter((peer) => peer.pendingRequests > 0).slice(0, 6),
    [peersTable]
  );

  useEffect(() => {
    if (topPeers.length === 0) {
      setSelectedPeerId("");
      return;
    }

    if (!selectedPeerId || !peersTable.some((peer) => peerSelectionKey(peer) === selectedPeerId)) {
      setSelectedPeerId(peerSelectionKey(topPeers[0]));
    }
  }, [topPeers, peersTable, selectedPeerId]);

  const selectedPeer = useMemo(() => {
    if (!selectedPeerId) return null;
    return peersTable.find((peer) => peerSelectionKey(peer) === selectedPeerId) ?? null;
  }, [peersTable, selectedPeerId]);

  const phaseSummary = useMemo(() => {
    const phases: Record<EventPhase, number> = {
      system: 0,
      discovery: 0,
      handshake: 0,
      transfer: 0,
      verification: 0,
      error: 0,
    };
    for (const line of eventLines.slice(-180)) {
      phases[line.phase] += 1;
    }
    return phases;
  }, [eventLines]);

  const displayEvents = useMemo(() => {
    if (isTurboMode) return [] as EventLine[];
    const source = eventStreamPaused ? pausedEventLines : eventLines;
    const query = eventSearchText.trim().toLowerCase();
    let verifiedCounter = 0;

    const filtered = source.filter((line) => {
      if (eventMode === "important") {
        if (!IMPORTANT_EVENT_TYPES.has(line.type)) return false;
        if (line.type === "piece_verified") {
          verifiedCounter += 1;
          if (verifiedCounter % 6 !== 0) return false;
        }
      } else if (eventMode === "errors" && line.level !== "error") {
        return false;
      }

      if (eventPhaseFilter !== "all" && line.phase !== eventPhaseFilter) {
        return false;
      }

      if (!query) return true;
      const searchable = `${line.type} ${line.summary} ${line.phase} ${line.peerKey ?? ""}`.toLowerCase();
      return searchable.includes(query);
    });

    return filtered.slice(-eventLimit);
  }, [eventLines, pausedEventLines, eventStreamPaused, eventSearchText, eventPhaseFilter, eventMode, eventLimit, isTurboMode]);

  const selectedEvent = useMemo(
    () => displayEvents.find((line) => line.id === selectedEventId) ?? null,
    [displayEvents, selectedEventId]
  );

  const avgPieceBytes = useMemo(() => {
    const totalBytes = downloadProgress?.totalBytes ?? 0;
    if (pieceTotal <= 0 || totalBytes <= 0) return 0;
    return totalBytes / pieceTotal;
  }, [downloadProgress?.totalBytes, pieceTotal]);

  const handleTogglePauseResume = async () => {
    if (!authToken || !session || isControlPending || isComplete) {
      return;
    }

    const action = isRunning ? "pause" : "resume";
    setIsControlPending(true);

    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: { status?: SessionPayload["status"] };
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `Failed to ${action} torrent`);
      }

      if (payload.data?.status) {
        setSession((current) => (current ? { ...current, status: payload.data?.status ?? current.status } : current));
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : `Unable to ${action} torrent`);
    } finally {
      setIsControlPending(false);
    }
  };

  const handleToggleSeeding = async (confirmed: boolean = false) => {
    if (!confirmed && !isSeeding) {
      setShowSeedingModal(true);
      return;
    }

    if (!authToken || !session || isSeedingTogglePending) {
      return;
    }

    setIsSeedingTogglePending(true);
    setShowSeedingModal(false);

    const newSeedingState = !isSeeding;

    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/seeding`, {
        method: "POST",
        headers: { 
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: newSeedingState }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: { seeding?: boolean };
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to toggle seeding");
      }

      setIsSeeding(newSeedingState);
      pushEventLine({
        id: `seeding-${newSeedingState ? "started" : "stopped"}-${Date.now()}`,
        timestamp: Date.now(),
        type: newSeedingState ? "torrent_seeding_started" : "torrent_seeding_stopped",
        phase: "system",
        level: "normal",
        summary: newSeedingState ? "Seeding enabled. Contributing to the torrent swarm." : "Seeding disabled.",
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to toggle seeding");
    } finally {
      setIsSeedingTogglePending(false);
    }
  };

  const handleToggleTurboMode = async () => {
    if (isTurboTogglePending) {
      return;
    }

    const targetTurboMode = !isTurboMode;
    setIsTurboTogglePending(true);
    setError(null);

    try {
      const currentResponse = await fetch("/api/settings", { cache: "no-store" });
      if (!currentResponse.ok) {
        throw new Error("Unable to load current runtime settings");
      }

      const currentSettings = (await currentResponse.json()) as RuntimeSettings;

      const updateResponse = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentSettings,
          turboMode: targetTurboMode,
        }),
      });

      const updatePayload = (await updateResponse.json()) as {
        success?: boolean;
        error?: string;
        updatedSettings?: RuntimeSettings;
      };

      if (!updateResponse.ok || updatePayload.success === false) {
        throw new Error(updatePayload.error ?? "Unable to update Turbo Mode");
      }

      const appliedTurboMode =
        typeof updatePayload.updatedSettings?.turboMode === "boolean"
          ? updatePayload.updatedSettings.turboMode
          : targetTurboMode;

      setIsTurboMode(appliedTurboMode);

      pushEventLine({
        id: `turbo-${appliedTurboMode ? "enabled" : "disabled"}-${Date.now()}`,
        timestamp: Date.now(),
        type: appliedTurboMode ? "turbo_mode_enabled" : "turbo_mode_disabled",
        phase: "system",
        level: "normal",
        summary: appliedTurboMode
          ? "Turbo mode enabled. Session switched to download-priority runtime."
          : "Turbo mode disabled. Full analytics runtime restored.",
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update Turbo Mode");
    } finally {
      setIsTurboTogglePending(false);
    }
  };

  useEffect(() => {
    if (!isComplete || completionNotified) return;
    setCompletionNotified(true);

    setSession((current) => (current ? { ...current, status: "completed", progress: 100 } : current));
    void fetchProgress();
    if (!isTurboMode) {
      void fetchPieces();
      void fetchPeers();
    }

    pushEventLine({
      id: `completion-${Date.now()}`,
      timestamp: Date.now(),
      type: "torrent_completed",
      phase: "verification",
      level: "normal",
      summary: "Download complete. File is ready for local download.",
    });
  }, [isComplete, completionNotified, fetchProgress, fetchPieces, fetchPeers, pushEventLine, isTurboMode]);

  const handleDownloadCompletedFile = async () => {
    if (!session) return;
    setIsDownloadPending(true);
    setError(null);

    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/open-folder`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to open");
    } catch {
      setError("Unable to open designated folder.");
    } finally {
      setTimeout(() => setIsDownloadPending(false), 800);
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">
      <main className="relative flex flex-col gap-10 w-full max-w-6xl px-5 py-8 flex-1">
        {isControlPending && (
          <div className="absolute inset-0 z-20 pointer-events-none">
            <div className="sticky top-4 flex justify-end p-2">
              <div className="rounded-lg border bg-card/95 backdrop-blur-sm px-4 py-3 w-72 shadow-lg">
                <p className="text-xs font-mono font-semibold text-foreground/70 mb-2">Applying swarm control...</p>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full w-2/3 bg-primary/80 animate-pulse" />
                </div>
                <p className="text-[11px] font-mono text-foreground/50 mt-2">Refreshing peers and piece state</p>
              </div>
            </div>
          </div>
        )}

        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 animate-fade-in-up">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex h-2 w-2">
                {isRunning && !isComplete ? (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </>
                ) : (
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground/40" />
                )}
              </span>
              <span className="text-xs font-bold text-primary uppercase tracking-wider font-mono">
                {isComplete ? "Completed" : isTurboMode ? "Turbo Download Mode" : isRunning ? "Live Analytics" : session?.status ?? "Paused"}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{fileName}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-foreground/60 font-mono">
              <span>ID: {sessionId}</span>
              <span className="w-1 h-1 rounded-full bg-foreground/20" />
              <span>{formatBytes(downloadProgress?.totalBytes ?? 0)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${
                isTurboMode
                  ? "border-primary/60 text-primary bg-primary/15"
                  : "border-foreground/20 text-foreground/60"
              }`}
            >
              {isTurboMode ? "TURBO ON" : "TURBO OFF"}
            </span>
            <button
              type="button"
              onClick={handleToggleTurboMode}
              disabled={isTurboTogglePending}
              className={`turbo-cta rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                isTurboMode ? "turbo-cta-on" : "turbo-cta-off"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className={`turbo-dot ${isTurboMode ? "turbo-dot-on" : ""}`} />
                {isTurboTogglePending
                  ? "Switching..."
                  : isTurboMode
                    ? "Disable Turbo"
                    : "Enable Turbo"}
              </span>
            </button>
          </div>
        </header>

        {isComplete && (
          <section className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">Torrent download completed</p>
                <p className="text-xs font-mono text-foreground/60">All pieces verified. The file is saved in your chosen folder.</p>
              </div>
              <button
                onClick={handleDownloadCompletedFile}
                disabled={isDownloadPending}
                className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {isDownloadPending ? "Opening..." : "Open Folder"}
              </button>
            </div>
          </section>
        )}

        {error && <p className="text-sm text-destructive font-medium">{error}</p>}

        {isInitialLoading ? (
          <InitialTorrentSkeleton />
        ) : (
          <>
        {isTurboMode && (
          <section className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 animate-fade-in-up">
            <p className="text-sm font-semibold text-primary">Turbo Mode is active</p>
            <p className="text-xs font-mono text-foreground/65 mt-1">
              Non-essential analytics are hidden to keep resources focused on piece transfer and disk writes.
            </p>
          </section>
        )}

        <section className="animate-fade-in-up delay-100 grid gap-4 grid-cols-2 lg:grid-cols-6">
          {!isTurboMode && (
            <>
          <div className="col-span-2 rounded-xl border bg-card p-5 relative overflow-hidden">
            <div className="absolute right-0 bottom-0 p-3 opacity-5 pointer-events-none">
              <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
            <p className="text-xs font-bold text-foreground/50 mb-1 uppercase tracking-wider font-mono">Peer State</p>
            <div className="flex gap-6 mt-3">
              <div>
                <p className="text-3xl font-bold tracking-tight text-primary">{health.active}</p>
                <p className="text-xs font-medium text-foreground/40 mt-1">Active</p>
              </div>
              <div>
                <p className="text-3xl font-bold tracking-tight text-accent">{health.choked}</p>
                <p className="text-xs font-medium text-foreground/40 mt-1">Choked</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 flex flex-col justify-center">
            <p className="text-xs font-bold text-foreground/50 mb-1 uppercase tracking-wider font-mono">Swarm Pressure</p>
            <p className="text-2xl font-bold tracking-tight text-foreground">{swarmPressure.pending}</p>
            <p className="text-xs text-foreground/50 font-mono mt-1">
              avg {swarmPressure.avgPending.toFixed(1)} req/peer • {swarmPressure.activeWithRequests} active requesters
            </p>
          </div>
            </>
          )}

          <div className={`${isTurboMode ? "col-span-2 lg:col-span-6" : "col-span-3"} rounded-xl border bg-card p-5 flex flex-col justify-center`}>
            <div className="flex justify-between items-end mb-2">
              <p className="text-xs font-bold text-foreground/50 uppercase tracking-wider font-mono">{isTurboMode ? "Download Transfer" : "Real-time Transfer"}</p>
              <div className="flex items-center gap-3">
                {!isComplete && (
                  <button
                    onClick={handleTogglePauseResume}
                    disabled={isControlPending}
                    aria-label={isControlPending ? "Applying torrent control" : isRunning ? "Pause torrent" : "Resume torrent"}
                    title={isControlPending ? "Applying" : isRunning ? "Pause" : "Play"}
                    className={`h-8 w-8 inline-flex items-center justify-center rounded-md border transition-colors ${
                      isRunning ? "hover:bg-secondary text-foreground" : "bg-primary text-primary-foreground border-transparent"
                    }`}
                  >
                    {isControlPending ? (
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : isRunning ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                        <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                )}
                <div className="flex gap-4 text-sm font-mono font-medium">
                <span className="text-primary flex items-center gap-1">↓ {formatSpeed(downloadProgress?.downloadSpeed ?? 0)}</span>
                <span className="text-accent flex items-center gap-1">↑ {formatSpeed(downloadProgress?.uploadSpeed ?? 0)}</span>
                </div>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden mt-2">
              <div className={`h-full rounded-full bg-primary transition-all duration-300 ${isRunning ? "progress-animated" : ""}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2.5 gap-3">
              {!isTurboMode ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground/70">Seeding</span>
                <button
                  onClick={() => {
                    if (!isSeeding) {
                      handleToggleSeeding(false);
                    } else {
                      handleToggleSeeding(true);
                    }
                  }}
                  disabled={isSeedingTogglePending}
                  className="relative inline-block"
                  title={isSeeding ? "Seeding: ON - Click to disable" : "Seeding: OFF - Click to enable"}
                >
                  <div className={`relative inline-flex h-4 w-7 items-center rounded-full transition-all ${
                    isSeeding ? "bg-green-600" : "bg-secondary"
                  }`}>
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
                        isSeeding ? "translate-x-3.5" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </button>
              </div>
              ) : (
                <p className="text-xs font-mono text-foreground/55">Turbo prioritizes download path only.</p>
              )}
              <div className="text-right space-y-0.5">
                <p className="text-xs font-mono font-medium text-foreground/50">{progress.toFixed(1)}% Completed</p>
                <p className="text-[11px] font-mono text-foreground/55">
                  {completedMbLabel} / {totalMbLabel}
                </p>
                <p className="text-[11px] font-mono text-foreground/55">ETA {etaLabel}</p>
                <p className="text-[11px] font-mono text-foreground/55">Peers {activePeerCount} active / {discoveredPeerCount} discovered</p>
              </div>
            </div>
          </div>
        </section>

        {!isTurboMode && (
          <>
        <section className="animate-fade-in-up delay-175">
          <PieceGrid pieces={pieces} totalPieces={pieceTotal} maxDisplay={420} tileSizePx={11} fullScreenHref={`/torrent/${sessionId}/pieces`} />
        </section>

        <section className="animate-fade-in-up delay-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-1 bg-primary rounded-full"></div>
              <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Peer Connectivity Topology</h2>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-secondary text-foreground/70 font-medium">
              {graphPeers.length} nodes • {trackers} trackers
            </span>
          </div>

          <div className="grid xl:grid-cols-[2fr_1fr] gap-5">
            <div className="relative">
              <div className="rounded-xl border bg-card overflow-hidden shadow-sm relative p-3">
                <PeerGraph peers={graphPeers} showGuide={false} monochromeLinks={true} animatedLinks={true} />
                <div className="absolute right-8 bottom-8 z-10">
                  <Link
                    href={`/torrent/${sessionId}/map`}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md border border-primary/50 text-primary hover:bg-primary/10 transition-colors bg-background/85"
                  >
                    Launch Full Topology ↦
                  </Link>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-xs font-bold text-foreground/70 uppercase tracking-wider font-mono mb-3">Swarm Insights</h3>
              <div className="grid grid-cols-3 gap-2 mb-3 text-[11px] font-mono">
                <div className="rounded-md border bg-background px-2 py-1.5">
                  <p className="text-foreground/55">Verified</p>
                  <p className="font-semibold text-green-600">{verifiedPeers}</p>
                </div>
                <div className="rounded-md border bg-background px-2 py-1.5">
                  <p className="text-foreground/55">Requesting</p>
                  <p className="font-semibold text-accent">{activeRequestPeers}</p>
                </div>
                <div className="rounded-md border bg-background px-2 py-1.5">
                  <p className="text-foreground/55">Peer bytes</p>
                  <p className="font-semibold text-primary">{formatBytes(totalDownloadedByPeers)}</p>
                </div>
              </div>

              <div className="mb-2 text-[11px] font-mono text-foreground/60">Top data contributors</div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {topContributors.map((peer) => {
                  const peerKey = peerSelectionKey(peer);
                  const sharePct = topContributors.length > 0 && topContributors[0].downloadedBytes > 0
                    ? Math.min(100, (peer.downloadedBytes / topContributors[0].downloadedBytes) * 100)
                    : 0;

                  return (
                    <div key={peerKey} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between text-xs font-mono mb-2">
                        <span className="text-foreground/70 truncate max-w-[170px]">{peer.ip}:{peer.port}</span>
                        <span className="font-semibold text-primary">{formatBytes(peer.downloadedBytes)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary/80" style={{ width: `${sharePct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-foreground/60 font-mono mt-2">
                        <span>{peer.pendingRequests} req pending</span>
                        <span>{peer.choked ? "choked" : "active"}</span>
                      </div>
                    </div>
                  );
                })}

                {topContributors.length === 0 && (
                  <p className="text-sm text-foreground/50 font-mono">Waiting for transfer contribution data</p>
                )}

                {requestHotspots.length > 0 && (
                  <div className="pt-2">
                    <div className="mb-2 text-[11px] font-mono text-foreground/60">Request hotspots</div>
                    {requestHotspots.map((peer) => {
                      const peerKey = peerSelectionKey(peer);
                      return (
                        <div key={`req-${peerKey}`} className="text-[11px] font-mono text-foreground/70 flex items-center justify-between py-1">
                          <span className="truncate max-w-[190px]">{peer.ip}:{peer.port}</span>
                          <span className="text-accent font-semibold">{peer.pendingRequests} req</span>
                        </div>
                      );
                    })}
                    </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-10 animate-fade-in-up delay-300">
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-4 w-1 bg-accent rounded-full"></div>
              <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Connected Peers</h2>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-foreground/60">
                  Top {topPeers.length} peers out of {peersTable.length}
                </p>
                <select
                  value={selectedPeerId}
                  onChange={(event) => setSelectedPeerId(event.target.value)}
                  className="rounded-md border bg-background px-2 py-1 text-xs font-mono"
                >
                  {peersTable.map((peer) => {
                    const peerKey = peerSelectionKey(peer);
                    return (
                      <option key={peerKey} value={peerKey}>
                        {peer.ip}:{peer.port}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {topPeers.slice(0, 12).map((peer) => {
                  const peerKey = peerSelectionKey(peer);
                  const isSelected = selectedPeerId === peerKey;
                  return (
                    <button
                      key={peerKey}
                      onClick={() => setSelectedPeerId(peerKey)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected ? "border-primary bg-primary/10" : "hover:bg-secondary/30"
                      }`}
                    >
                      <div className="text-xs font-mono text-foreground/80 truncate">{peer.ip}:{peer.port}</div>
                      <div className="text-[11px] text-foreground/55">{peer.pendingRequests} req • {peer.choked ? "choked" : "active"}</div>
                    </button>
                  );
                })}
              </div>

              {selectedPeer && (() => {
                const peerRouteId = selectedPeer.peerId ?? peerAddressKey(selectedPeer);
                const ownedPct = selectedPeer.piecesAvailableKnown && pieceTotal > 0
                  ? Math.min(100, (selectedPeer.piecesAvailable / pieceTotal) * 100)
                  : 0;
                const fetchedPiecesEstimate = avgPieceBytes > 0
                  ? Math.min(pieceTotal, Math.floor(selectedPeer.downloadedBytes / avgPieceBytes))
                  : 0;
                const stageFromPeerId = selectedPeer.peerId ? recentByPeer.get(selectedPeer.peerId) : undefined;
                const stageFromAddress = recentByPeer.get(peerAddressKey(selectedPeer));
                const stageLabel = STAGE_LABELS[Math.min(4, stageFromPeerId ?? stageFromAddress ?? 0)];

                return (
                  <div className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-mono text-foreground/70">Peer Details</p>
                      <Link href={`/peer/${peerRouteId}`} className="text-xs font-semibold text-primary hover:underline">open</Link>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div>
                        Owned: {selectedPeer.piecesAvailableKnown
                          ? `${selectedPeer.piecesAvailable}/${Math.max(1, pieceTotal)}`
                          : "unknown (peer bitfield not exposed)"}
                      </div>
                      <div>Fetched: {fetchedPiecesEstimate}/{Math.max(1, pieceTotal)}</div>
                      <div>Stage: {stageLabel}</div>
                      <div>Pending: {selectedPeer.pendingRequests}</div>
                      <div>Enc: {selectedPeer.encryption === "mse-rc4" ? "MSE/RC4" : selectedPeer.encryption}</div>
                    </div>
                    <div className="mt-3">
                      <div className="text-[11px] text-foreground/60 mb-1">Piece ownership</div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full ${selectedPeer.piecesAvailableKnown ? "bg-primary" : "bg-foreground/30"}`} style={{ width: `${ownedPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {!selectedPeer && (
                <p className="text-xs font-mono text-foreground/50">No peers connected yet.</p>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-1 bg-primary rounded-full"></div>
                <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Protocol Event Stream</h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEventViewMode((current) => (current === "log" ? "timeline" : "log"))}
                  className="rounded-md border px-3 py-1 text-xs font-semibold hover:bg-secondary"
                >
                  {eventViewMode === "log" ? "Timeline view" : "Protocol log view"}
                </button>
                <button onClick={handleToggleEventStreamPause} className="rounded-md border px-3 py-1 text-xs font-semibold hover:bg-secondary">
                  {eventStreamPaused ? "Resume" : "Pause"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border bg-background overflow-hidden relative shadow-inner">
              <div className="px-4 py-2 border-b bg-secondary/20 text-[11px] font-mono text-foreground/60 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={eventSearchText}
                    onChange={(event) => setEventSearchText(event.target.value)}
                    placeholder="Search event type, summary, peer..."
                    className="h-7 w-56 rounded-md border bg-background px-2 text-[11px]"
                  />
                  <select
                    value={eventMode}
                    onChange={(event) => setEventMode(event.target.value as "all" | "important" | "errors")}
                    className="h-7 rounded-md border bg-background px-2 text-[11px]"
                  >
                    <option value="all">All events</option>
                    <option value="important">Milestones only</option>
                    <option value="errors">Errors only</option>
                  </select>
                  <select
                    value={eventPhaseFilter}
                    onChange={(event) => setEventPhaseFilter(event.target.value as "all" | EventPhase)}
                    className="h-7 rounded-md border bg-background px-2 text-[11px]"
                  >
                    <option value="all">All phases</option>
                    <option value="system">System</option>
                    <option value="discovery">Discovery</option>
                    <option value="handshake">Handshake</option>
                    <option value="transfer">Transfer</option>
                    <option value="verification">Verification</option>
                    <option value="error">Error</option>
                  </select>
                  <select
                    value={String(eventLimit)}
                    onChange={(event) => setEventLimit(Number(event.target.value))}
                    className="h-7 rounded-md border bg-background px-2 text-[11px]"
                  >
                    <option value="60">Last 60</option>
                    <option value="120">Last 120</option>
                    <option value="220">Last 220</option>
                  </select>
                </div>
                <div>{displayEvents.length} events shown. Click a row to inspect details.</div>
              </div>
              {eventViewMode === "log" ? (
                <>
                  <div className="border-b px-4 py-2 bg-card text-xs font-mono text-foreground/50 flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
                    <span className="ml-2">protocol_log</span>
                  </div>
                  <div className="h-[445px] overflow-y-auto p-4 font-mono text-[13px] leading-6 bg-background/80">
                    {displayEvents.map((line, i) => {
                      const tag = protocolTagForEvent(line);
                      return (
                        <button
                          key={line.id}
                          onClick={() => setSelectedEventId(line.id)}
                          className={`w-full text-left rounded px-1 transition-colors ${
                            selectedEventId === line.id ? "bg-secondary/45" : "hover:bg-secondary/30"
                          } ${i === displayEvents.length - 1 ? "animate-fade-in-up" : ""}`}
                        >
                          <span className={`${protocolTagClass[tag]} font-semibold`}>[{tag}]</span>
                          <span className="text-foreground/70 ml-2">{line.summary}</span>
                        </button>
                      );
                    })}
                    {displayEvents.length === 0 && <p className="text-foreground/50">Waiting for events...</p>}
                  </div>
                </>
              ) : (
                <>
                  <div className="absolute top-0 w-full h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
                  <div className="h-[445px] overflow-y-auto p-5 font-mono text-xs space-y-2.5">
                    {displayEvents.map((line, i) => (
                      <button
                        key={line.id}
                        onClick={() => setSelectedEventId(line.id)}
                        className={`w-full text-left rounded-md px-1.5 py-1 transition-colors ${
                          selectedEventId === line.id ? "bg-secondary/45" : "hover:bg-secondary/30"
                        } ${i === displayEvents.length - 1 ? "animate-fade-in-up" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-foreground/30 flex-shrink-0 mt-0.5">{formatTime(line.timestamp)}</span>
                          <span className={line.level === "error" ? "text-destructive" : line.phase === "handshake" ? "text-accent" : "text-foreground/60"}>
                            [{line.type}] {line.summary}
                          </span>
                        </div>
                      </button>
                    ))}
                    {displayEvents.length === 0 && <p className="text-foreground/50">Waiting for events...</p>}
                  </div>
                </>
              )}
              {selectedEvent && (
                <div className="border-t bg-secondary/10 px-4 py-2 text-[11px] font-mono text-foreground/70">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>type: {selectedEvent.type}</span>
                    <span>phase: {selectedEvent.phase}</span>
                    {selectedEvent.peerKey && <span>peer: {selectedEvent.peerKey}</span>}
                    <span>time: {formatTime(selectedEvent.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-foreground/80">{selectedEvent.summary}</div>
                </div>
              )}
            </div>
          </section>
        </div>
          </>
        )}
          </>
        )}

        {showSeedingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-xl border bg-card shadow-2xl max-w-md mx-4 p-6 animate-fade-in-up">
              <h2 className="text-xl font-bold tracking-tight mb-3">Enable Seeding?</h2>
              
              <div className="space-y-3 mb-6 text-sm text-foreground/80">
                <p>
                  <strong>What is seeding?</strong><br/>
                  Seeding means uploading pieces of the file you've downloaded to other people who are trying to get the same content.
                </p>
                
                <p>
                  <strong>How does it help?</strong><br/>
                  When you seed, you help others download faster and keep the torrent alive for future users. The more people seeding, the healthier the network.
                </p>
                
                <p>
                  <strong>When will it start?</strong><br/>
                  Seeding will begin immediately, even while you're still downloading. You'll share pieces as soon as they're verified.
                </p>

                <p>
                  <strong>What's the impact?</strong><br/>
                  Your upload bandwidth will be used. Other peers will connect to you to download what you have. You can stop anytime.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSeedingModal(false)}
                  className="flex-1 rounded-md border px-4 py-2 text-sm font-semibold hover:bg-secondary transition-colors"
                >
                  Not Now
                </button>
                <button
                  onClick={() => handleToggleSeeding(true)}
                  disabled={isSeedingTogglePending}
                  className="flex-1 rounded-md border-transparent bg-accent text-accent-foreground px-4 py-2 text-sm font-semibold hover:bg-accent/90 disabled:opacity-60 transition-colors"
                >
                  {isSeedingTogglePending ? "Enabling..." : "Yes, Let's Seed"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
