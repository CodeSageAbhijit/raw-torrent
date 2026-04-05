"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BackendEvent, getBackendHttpUrl, getBackendWsUrl } from "@/lib/backend";
import {
  loadCachedSessions,
  removeCachedSession,
  upsertCachedSessions,
  type SessionCacheRecord,
} from "@/lib/session-cache";

type BackendSession = {
  sessionId: string;
  fileName: string;
  status: "idle" | "starting" | "running" | "paused" | "completed" | "error" | "stopped";
  progress: number;
  peers: Array<{ ip: string; port: number; peerId?: string }>;
};

const isActiveStatus = (status: BackendSession["status"]) => status === "running" || status === "starting";

const sortSessions = (sessions: BackendSession[]) =>
  sessions.slice().sort((a, b) => {
    const aActive = isActiveStatus(a.status);
    const bActive = isActiveStatus(b.status);

    if (aActive !== bActive) {
      return aActive ? -1 : 1;
    }

    if (a.progress !== b.progress) {
      return b.progress - a.progress;
    }

    return a.sessionId.localeCompare(b.sessionId);
  });

const toBackendSession = (cached: SessionCacheRecord): BackendSession => ({
  sessionId: cached.sessionId,
  fileName: cached.fileName,
  status: cached.status,
  progress: cached.progress,
  peers: cached.peers,
});

const mergeSessions = (preferred: BackendSession[], fallback: BackendSession[]) => {
  const byId = new Map<string, BackendSession>();

  for (const session of fallback) {
    byId.set(session.sessionId, session);
  }

  for (const session of preferred) {
    byId.set(session.sessionId, session);
  }

  return sortSessions(Array.from(byId.values()));
};

export default function DashboardPage() {
  const [sessions, setSessions] = useState<BackendSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingSessionIds, setDeletingSessionIds] = useState<string[]>([]);

  const isDeletingSession = (sessionId: string) => deletingSessionIds.includes(sessionId);

  const handleDeleteSession = async (session: BackendSession) => {
    if (isDeletingSession(session.sessionId)) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${session.fileName}" and remove all related files and session data?`
    );

    if (!confirmed) {
      return;
    }

    setDeletingSessionIds((current) => [...current, session.sessionId]);
    setError(null);

    try {
      const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${session.sessionId}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to delete torrent session");
      }

      setSessions((current) => current.filter((item) => item.sessionId !== session.sessionId));
      removeCachedSession(session.sessionId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to delete torrent session");
    } finally {
      setDeletingSessionIds((current) => current.filter((id) => id !== session.sessionId));
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);

      const cachedSessions = loadCachedSessions().map(toBackendSession);
      if (!cancelled && cachedSessions.length > 0) {
        setSessions(cachedSessions);
      }

      try {
        const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions`);

        const payload = (await response.json()) as {
          success: boolean;
          error?: string;
          data?: BackendSession[];
        };

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "Failed to load sessions");
        }

        const liveSessions = payload.data;
        let nextSessions = mergeSessions(liveSessions, cachedSessions);

        if (cachedSessions.length > 0) {
          const liveIds = new Set(liveSessions.map((session) => session.sessionId));
          const missingIds = cachedSessions
            .map((session) => session.sessionId)
            .filter((sessionId) => !liveIds.has(sessionId))
            .slice(0, 12);

          if (missingIds.length > 0) {
            const recovered = await Promise.all(
              missingIds.map(async (sessionId) => {
                try {
                  const byIdResponse = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}`);
                  if (!byIdResponse.ok) {
                    return null;
                  }

                  const byIdPayload = (await byIdResponse.json()) as {
                    success: boolean;
                    data?: BackendSession;
                  };

                  if (!byIdPayload.success || !byIdPayload.data) {
                    return null;
                  }

                  return byIdPayload.data;
                } catch {
                  return null;
                }
              })
            );

            nextSessions = mergeSessions(
              recovered.filter((session): session is BackendSession => session !== null),
              nextSessions
            );
          }
        }

        if (!cancelled) {
          setSessions(nextSessions);
          if (nextSessions.length > 0) {
            upsertCachedSessions(nextSessions);
          }
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "Failed to load sessions");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessions.length === 0) {
      return;
    }

    upsertCachedSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    const ws = new WebSocket(`${getBackendWsUrl()}/ws`);

    ws.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data as string) as BackendEvent;

        if (!event.sessionId) {
          return;
        }

        const eventSessionId = event.sessionId;

        if (event.type === "torrent_started") {
          setSessions((current) => {
            const exists = current.some((session) => session.sessionId === eventSessionId);
            if (exists) {
              return current;
            }

            const data = event.data as { fileName?: string };
            return [
              {
                sessionId: eventSessionId,
                fileName: data.fileName ?? eventSessionId,
                status: "starting",
                progress: 0,
                peers: [],
              },
              ...current,
            ];
          });
        }

        if (event.type === "peer_discovered") {
          setSessions((current) =>
            current.map((session) => {
              if (session.sessionId !== eventSessionId) {
                return session;
              }

              const data = event.data as { ip?: string; port?: number; peerId?: string };
              if (!data.ip || !data.port) {
                return session;
              }

              const exists = session.peers.some((peer) => peer.ip === data.ip && peer.port === data.port);
              if (exists) {
                return session;
              }

              return {
                ...session,
                peers: [...session.peers, { ip: data.ip, port: data.port, peerId: data.peerId }],
              };
            })
          );
        }

        if (event.type === "torrent_progress") {
          setSessions((current) =>
            current.map((session) => {
              if (session.sessionId !== eventSessionId) {
                return session;
              }

              const data = event.data as { progress?: number };
              return {
                ...session,
                status: "running",
                progress: typeof data.progress === "number" ? data.progress : session.progress,
              };
            })
          );
        }

        if (event.type === "torrent_completed") {
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === eventSessionId
                ? { ...session, status: "completed", progress: 100 }
                : session
            )
          );
        }
      } catch {
        // no-op
      }
    };

    return () => {
      // In React dev lifecycle, teardown can happen before the handshake finishes.
      // Avoid closing while CONNECTING to prevent noisy browser errors.
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener(
          "open",
          () => {
            ws.close();
          },
          { once: true }
        );
        return;
      }

      ws.close();
    };
  }, []);

  const summary = useMemo(() => {
    const active = sessions.filter((session) => isActiveStatus(session.status)).length;
    const peers = sessions.reduce((sum, session) => sum + session.peers.length, 0);
    const completion = sessions.length
      ? Number((sessions.reduce((sum, session) => sum + session.progress, 0) / sessions.length).toFixed(1))
      : 0;

    return { active, peers, completion };
  }, [sessions]);

  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">
      <main className="flex flex-col gap-12 w-full max-w-5xl px-5 py-10 flex-1">
        <header className="animate-fade-in-up">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-foreground/60 mt-1.5 text-lg">
            Monitor network activity and initialize new protocol sessions.
          </p>
          {error && <p className="text-sm text-destructive mt-3 font-medium">{error}</p>}
        </header>

        <section className="animate-fade-in-up delay-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-primary rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Network Overview</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Active Sessions</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight text-primary">{summary.active}</p>
                <p className="text-xs font-medium text-foreground/40 hidden sm:block">torrents</p>
              </div>
            </div>

            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Peer Connections</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight">{summary.peers}</p>
                <p className="text-xs font-medium text-foreground/40 hidden sm:block">nodes</p>
              </div>
            </div>

            <div className="card-hover rounded-xl border bg-card p-6 shadow-sm relative overflow-hidden">
              <p className="text-xs font-semibold text-foreground/50 mb-2 uppercase tracking-wider font-mono">Avg Completion</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold tracking-tight">{summary.completion}</p>
                <p className="text-xs font-medium text-foreground/40">%</p>
              </div>
            </div>
          </div>
        </section>

        <section className="animate-fade-in-up delay-200">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-primary rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Active Torrents</h2>
          </div>
          <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-secondary/30 text-xs font-mono text-foreground/50 uppercase tracking-wider">
                    <th className="text-left p-4 font-semibold">T_Name</th>
                    <th className="text-left p-4 font-semibold">State</th>
                    <th className="text-left p-4 font-semibold">Completion</th>
                    <th className="text-left p-4 font-semibold">Peers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessions.length === 0 && (
                    <tr>
                      <td className="p-4 text-foreground/50" colSpan={4}>
                        No sessions yet. Start one from the Download page.
                      </td>
                    </tr>
                  )}
                  {sessions.map((session) => (
                    <tr key={session.sessionId} className="group hover:bg-secondary/40 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <Link
                            href={`/torrent/${session.sessionId}`}
                            className="hover:text-primary transition-colors font-medium hover:underline truncate"
                          >
                            {session.fileName}
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSession(session)}
                            disabled={isDeletingSession(session.sessionId)}
                            className="inline-flex items-center rounded-md border border-destructive/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isDeletingSession(session.sessionId) ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase bg-primary/10 text-primary border border-primary/20">
                          {session.status}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${session.progress}%` }} />
                          </div>
                          <span className="text-foreground/70 font-mono text-xs font-medium">{session.progress}%</span>
                        </div>
                      </td>
                      <td className="p-4 text-foreground/70 font-mono text-xs">{session.peers.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
