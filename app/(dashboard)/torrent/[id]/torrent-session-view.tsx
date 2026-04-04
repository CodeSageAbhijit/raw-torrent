"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PieceGrid from "@/components/piece-grid";
import PeerGraph, { type GraphPeer } from "@/components/peer-graph";
import { BackendEvent, getBackendHttpUrl, getBackendWsUrl } from "@/lib/backend";

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

const IMPORTANT_EVENT_TYPES = new Set([
  "torrent_started",
  "torrent_paused",
  "torrent_resumed",
  "torrent_completed",
  "torrent_error",
  "peer_discovered",
  "peer_choked",
  "peer_unchoked",
  "piece_verified",
  "piece_failed",
]);

const STAGE_LABELS = ["discovered", "handshake", "unchoked", "requesting", "verified"] as const;

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
  const ip = typeof data.ip === "string" ? data.ip : null;
  const port = typeof data.port === "number" ? `:${data.port}` : "";
  const speed = typeof data.downloadSpeed === "number" ? `speed ${(data.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s` : null;

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

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-US", { hour12: false });

function LoadingBlock({ className }: { className: string }) {
  return <div className={`rounded-lg bg-secondary/60 animate-pulse ${className}`} />;
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
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");

  const pushEventLine = useCallback((next: EventLine) => {
    setEventLines((current) => [...current, next].slice(-320));
  }, []);

  useEffect(() => {
    setAuthToken("local-bypass");
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
    if (!authToken) return;
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
  }, [sessionId, authToken]);

  const fetchPieces = useCallback(async () => {
    if (!authToken) return;
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
  }, [sessionId, authToken]);

  const hydrateInitialMetrics = useCallback(async () => {
    if (!authToken) return;
    await Promise.all([fetchProgress(), fetchPeers(), fetchPieces()]);
    setIsMetricsHydrated(true);
  }, [authToken, fetchProgress, fetchPeers, fetchPieces]);

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

    const progressTimer = setInterval(fetchProgress, 1500);
    const peerTimer = setInterval(fetchPeers, 3500);
    const pieceTimer = setInterval(fetchPieces, 4500);

    return () => {
      clearInterval(progressTimer);
      clearInterval(peerTimer);
      clearInterval(pieceTimer);
    };
  }, [authToken, fetchProgress, fetchPeers, fetchPieces, hydrateInitialMetrics]);

  useEffect(() => {
    const socket = new WebSocket(`${getBackendWsUrl()}/ws`);

    socket.onmessage = (rawMessage) => {
      try {
        const event = JSON.parse(rawMessage.data as string) as BackendEvent;
        if (event.sessionId && event.sessionId !== sessionId) return;

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

    return () => socket.close();
  }, [sessionId, fetchPeers, fetchPieces, pushEventLine]);

  const isRunning = session?.status === "running";
  const progress = downloadProgress?.progress ?? session?.progress ?? 0;
  const isComplete = session?.status === "completed" || progress >= 99.9;
  const isInitialLoading = !isSessionHydrated || !isMetricsHydrated;
  const fileName = session?.fileName ?? `Session ${sessionId}`;
  const pieceTotal = downloadProgress?.piecesTotal ?? session?.pieceCount ?? pieces.length;

  const mappedPeers = useMemo<PeerDownloadState[]>(() => {
    if (peerStates.length > 0) return peerStates;
    return (
      session?.peers.map((peer) => ({
        ip: peer.ip,
        port: peer.port,
        peerId: peer.peerId,
        choked: false,
        piecesAvailable: 0,
        downloadedBytes: 0,
        pendingRequests: 0,
      })) ?? []
    );
  }, [peerStates, session?.peers]);

  const trackers = useMemo(() => {
    if (!session?.trackerUrl) return 0;
    return session.trackerUrl.split(",").filter((item) => item.trim().length > 0).length;
  }, [session?.trackerUrl]);

  const health = useMemo(() => {
    const active = mappedPeers.filter((peer) => !peer.choked).length;
    const choked = mappedPeers.length - active;
    return { active, choked };
  }, [mappedPeers]);

  const swarmPressure = useMemo(() => {
    const pending = mappedPeers.reduce((sum, peer) => sum + peer.pendingRequests, 0);
    const avgPending = mappedPeers.length ? pending / mappedPeers.length : 0;
    const activeWithRequests = mappedPeers.filter((peer) => peer.pendingRequests > 0).length;
    return { pending, avgPending, activeWithRequests };
  }, [mappedPeers]);

  const recentByPeer = useMemo(() => {
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
  }, [eventLines]);

  const graphPeers = useMemo<GraphPeer[]>(() => {
    return mappedPeers.slice(0, 120).map((peer) => {
      const key = peer.peerId ?? `${peer.ip}:${peer.port}`;
      const activity = Math.min(1, (peer.pendingRequests + peer.piecesAvailable / 64 + (peer.downloadedBytes > 0 ? 1 : 0)) / 6);
      return {
        id: key,
        label: key,
        stage: (recentByPeer.get(key) ?? 0) as 0 | 1 | 2 | 3 | 4,
        activity,
        downloadLabel: `${formatBytes(peer.downloadedBytes)}`,
        uploadLabel: `${peer.pendingRequests} req`,
      };
    });
  }, [mappedPeers, recentByPeer]);

  const peersTable = useMemo(
    () => [...mappedPeers].sort((a, b) => b.downloadedBytes - a.downloadedBytes),
    [mappedPeers]
  );

  const topPeers = useMemo(() => peersTable.slice(0, 24), [peersTable]);

  useEffect(() => {
    if (topPeers.length === 0) {
      setSelectedPeerId("");
      return;
    }

    if (!selectedPeerId || !peersTable.some((peer) => (peer.peerId ?? `${peer.ip}:${peer.port}`) === selectedPeerId)) {
      setSelectedPeerId(topPeers[0].peerId ?? `${topPeers[0].ip}:${topPeers[0].port}`);
    }
  }, [topPeers, peersTable, selectedPeerId]);

  const selectedPeer = useMemo(() => {
    if (!selectedPeerId) return null;
    return peersTable.find((peer) => (peer.peerId ?? `${peer.ip}:${peer.port}`) === selectedPeerId) ?? null;
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
    const source = eventStreamPaused ? eventLines.slice(0, Math.max(0, eventLines.length - 1)) : eventLines;
    let verifiedCounter = 0;
    const filtered = source.filter((line) => {
      if (!IMPORTANT_EVENT_TYPES.has(line.type)) return false;
      if (line.type === "piece_verified") {
        verifiedCounter += 1;
        return verifiedCounter % 8 === 0;
      }
      return true;
    });
    return filtered.slice(-80);
  }, [eventLines, eventStreamPaused]);

  const avgPieceBytes = useMemo(() => {
    const totalBytes = downloadProgress?.totalBytes ?? 0;
    if (pieceTotal <= 0 || totalBytes <= 0) return 0;
    return totalBytes / pieceTotal;
  }, [downloadProgress?.totalBytes, pieceTotal]);

  const encryptionStatus = useMemo(() => {
    const signal = eventLines
      .slice(-220)
      .map((line) => `${line.type} ${line.summary}`.toLowerCase())
      .join(" ");

    if (signal.includes("rc4") || signal.includes("mse")) return "RC4/MSE observed";
    if (signal.includes("plaintext")) return "Plaintext observed";
    return "Unknown (backend does not expose per-peer encryption yet)";
  }, [eventLines]);

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

  useEffect(() => {
    if (!isComplete || completionNotified) return;
    setCompletionNotified(true);

    setSession((current) => (current ? { ...current, status: "completed", progress: 100 } : current));
    void fetchProgress();
    void fetchPieces();
    void fetchPeers();

    pushEventLine({
      id: `completion-${Date.now()}`,
      timestamp: Date.now(),
      type: "torrent_completed",
      phase: "verification",
      level: "normal",
      summary: "Download complete. File is ready for local download.",
    });
  }, [isComplete, completionNotified, fetchProgress, fetchPieces, fetchPeers, pushEventLine]);

  const handleDownloadCompletedFile = () => {
    if (!session) return;
    setIsDownloadPending(true);
    setError(null);

    try {
      const downloadUrl = `${getBackendHttpUrl()}/torrent/sessions/${sessionId}/download`;
      window.location.href = downloadUrl;
    } catch {
      setError("Unable to start file download");
    } finally {
      setTimeout(() => setIsDownloadPending(false), 1200);
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
                {isRunning && !isComplete ? "Live Analytics" : isComplete ? "Completed" : session?.status ?? "Paused"}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{fileName}</h1>
            <div className="flex items-center gap-3 mt-2 text-sm text-foreground/60 font-mono">
              <span>ID: {sessionId}</span>
              <span className="w-1 h-1 rounded-full bg-foreground/20" />
              <span>{formatBytes(downloadProgress?.totalBytes ?? 0)}</span>
              <span className="w-1 h-1 rounded-full bg-foreground/20" />
              <span className="text-primary font-bold">Enc: {encryptionStatus}</span>
            </div>
          </div>
          <div className="flex gap-3">
            {isComplete ? (
              <button
                onClick={handleDownloadCompletedFile}
                disabled={isDownloadPending}
                className="btn-animate rounded-lg bg-primary text-primary-foreground border-transparent border px-5 py-2.5 text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-60"
              >
                {isDownloadPending ? "Preparing file..." : "Download File"}
              </button>
            ) : (
              <button
                onClick={handleTogglePauseResume}
                disabled={isControlPending}
                className={`btn-animate rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors ${
                  isRunning ? "hover:bg-secondary text-foreground" : "bg-primary text-primary-foreground border-transparent"
                }`}
              >
                {isControlPending ? "Please wait..." : isRunning ? "Pause Stream" : "Resume"}
              </button>
            )}
            <button
              onClick={() => router.push("/dashboard")}
              className="btn-animate rounded-lg bg-destructive/10 px-5 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
            >
              Drop
            </button>
          </div>
        </header>

        {isComplete && (
          <section className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">Torrent download completed</p>
                <p className="text-xs font-mono text-foreground/60">All pieces verified. You can download the assembled file now.</p>
              </div>
              <button
                onClick={handleDownloadCompletedFile}
                disabled={isDownloadPending}
                className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {isDownloadPending ? "Preparing file..." : "Download now"}
              </button>
            </div>
          </section>
        )}

        {error && <p className="text-sm text-destructive font-medium">{error}</p>}

        {isInitialLoading ? (
          <InitialTorrentSkeleton />
        ) : (
          <>
        <section className="animate-fade-in-up delay-100 grid gap-4 grid-cols-2 lg:grid-cols-6">
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

          <div className="col-span-3 rounded-xl border bg-card p-5 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-2">
              <p className="text-xs font-bold text-foreground/50 uppercase tracking-wider font-mono">Real-time Transfer</p>
              <div className="flex gap-4 text-sm font-mono font-medium">
                <span className="text-primary flex items-center gap-1">↓ {formatSpeed(downloadProgress?.downloadSpeed ?? 0)}</span>
                <span className="text-accent flex items-center gap-1">↑ {formatSpeed(downloadProgress?.uploadSpeed ?? 0)}</span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-secondary overflow-hidden mt-2">
              <div className={`h-full rounded-full bg-primary transition-all duration-300 ${isRunning ? "progress-animated" : ""}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
            <p className="text-xs font-mono font-medium text-foreground/50 mt-2 text-right">{progress.toFixed(1)}% Completed</p>
          </div>
        </section>

        <section className="animate-fade-in-up delay-150 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[10px] uppercase font-mono text-foreground/50">Discovery</p>
            <p className="text-xl font-semibold">{phaseSummary.discovery}</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[10px] uppercase font-mono text-foreground/50">Handshake</p>
            <p className="text-xl font-semibold text-primary">{phaseSummary.handshake}</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[10px] uppercase font-mono text-foreground/50">Transfer</p>
            <p className="text-xl font-semibold text-accent">{phaseSummary.transfer}</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[10px] uppercase font-mono text-foreground/50">Verified</p>
            <p className="text-xl font-semibold text-green-500">{phaseSummary.verification}</p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[10px] uppercase font-mono text-foreground/50">Errors</p>
            <p className="text-xl font-semibold text-destructive">{phaseSummary.error}</p>
          </div>
        </section>

        <section className="animate-fade-in-up delay-175">
          <PieceGrid pieces={pieces} totalPieces={pieceTotal} maxDisplay={1200} />
        </section>

        <section className="animate-fade-in-up delay-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-1 bg-primary rounded-full"></div>
              <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Peer Connectivity Topology</h2>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-secondary text-foreground/70 font-medium">
                {graphPeers.length} nodes • {trackers} trackers
              </span>
              <Link
                href={`/torrent/${sessionId}/map`}
                className="text-xs font-semibold px-3 py-1.5 rounded-md border border-primary/50 text-primary hover:bg-primary/10 transition-colors"
              >
                Launch Full Topology ↦
              </Link>
            </div>
          </div>

          <div className="grid xl:grid-cols-[2fr_1fr] gap-5">
            <div className="rounded-xl border bg-card overflow-hidden shadow-sm relative p-3">
              <PeerGraph peers={graphPeers} />
            </div>

            <div className="rounded-xl border bg-card p-4">
              <h3 className="text-xs font-bold text-foreground/70 uppercase tracking-wider font-mono mb-3">Handshake lanes</h3>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {graphPeers.slice(0, 18).map((peer) => (
                  <div key={peer.id} className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between text-xs font-mono mb-2">
                      <span className="text-foreground/70 truncate max-w-[170px]">{peer.label}</span>
                      <span className="font-semibold text-primary">{STAGE_LABELS[peer.stage]}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-accent via-primary to-green-500" style={{ width: `${((peer.stage + 1) / 5) * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-foreground/60 font-mono mt-2">
                      <span>{peer.downloadLabel}</span>
                      <span>{peer.uploadLabel}</span>
                    </div>
                  </div>
                ))}
                {graphPeers.length === 0 && <p className="text-sm text-foreground/50 font-mono">Waiting for peer activity</p>}
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
                    const peerId = peer.peerId ?? `${peer.ip}:${peer.port}`;
                    return (
                      <option key={peerId} value={peerId}>
                        {peer.ip}:{peer.port}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {topPeers.slice(0, 12).map((peer) => {
                  const peerId = peer.peerId ?? `${peer.ip}:${peer.port}`;
                  const isSelected = selectedPeerId === peerId;
                  return (
                    <button
                      key={peerId}
                      onClick={() => setSelectedPeerId(peerId)}
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
                const peerId = selectedPeer.peerId ?? `${selectedPeer.ip}:${selectedPeer.port}`;
                const ownedPct = pieceTotal > 0 ? Math.min(100, (selectedPeer.piecesAvailable / pieceTotal) * 100) : 0;
                const fetchedPiecesEstimate = avgPieceBytes > 0
                  ? Math.min(pieceTotal, Math.floor(selectedPeer.downloadedBytes / avgPieceBytes))
                  : 0;
                const stageLabel = STAGE_LABELS[Math.min(4, recentByPeer.get(peerId) ?? 0)];

                return (
                  <div className="rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-mono text-foreground/70">Peer Details</p>
                      <Link href={`/peer/${peerId}`} className="text-xs font-semibold text-primary hover:underline">open</Link>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div>Owned: {selectedPeer.piecesAvailable}/{Math.max(1, pieceTotal)}</div>
                      <div>Fetched: {fetchedPiecesEstimate}/{Math.max(1, pieceTotal)}</div>
                      <div>Stage: {stageLabel}</div>
                      <div>Pending: {selectedPeer.pendingRequests}</div>
                    </div>
                    <div className="mt-3">
                      <div className="text-[11px] text-foreground/60 mb-1">Piece ownership</div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${ownedPct}%` }} />
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
                <button onClick={() => setEventStreamPaused((value) => !value)} className="rounded-md border px-3 py-1 text-xs font-semibold hover:bg-secondary">
                  {eventStreamPaused ? "Resume" : "Pause"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border bg-background overflow-hidden relative shadow-inner">
              <div className="px-4 py-2 border-b bg-secondary/20 text-[11px] font-mono text-foreground/60">
                Timeline only includes protocol milestones and filtered verification checkpoints.
              </div>
              <div className="absolute top-0 w-full h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
              <div className="h-[360px] overflow-y-auto p-5 font-mono text-xs space-y-2.5">
                {displayEvents.map((line, i) => (
                  <div key={line.id} className={`flex items-start gap-3 ${i === displayEvents.length - 1 ? "animate-fade-in-up" : ""}`}>
                    <span className="text-foreground/30 flex-shrink-0 mt-0.5">{formatTime(line.timestamp)}</span>
                    <span className={line.level === "error" ? "text-destructive" : line.phase === "handshake" ? "text-accent" : "text-foreground/60"}>
                      [{line.type}] {line.summary}
                    </span>
                  </div>
                ))}
                {displayEvents.length === 0 && <p className="text-foreground/50">Waiting for events...</p>}
              </div>
            </div>
          </section>
        </div>
          </>
        )}
      </main>
    </div>
  );
}
