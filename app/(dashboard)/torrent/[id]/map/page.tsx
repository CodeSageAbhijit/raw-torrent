"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PeerGraph, { type GraphPeer } from "@/components/peer-graph";
import { getBackendHttpUrl } from "@/lib/backend";

type PeerDownloadState = {
  ip: string;
  port: number;
  peerId?: string;
  choked: boolean;
  piecesAvailable: number;
  downloadedBytes: number;
  pendingRequests: number;
};

export default function FullScreenMapPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [peers, setPeers] = useState<PeerDownloadState[]>([]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const loadPeers = async () => {
      try {
        const response = await fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/peers`, {
          headers: { Authorization: "Bearer local-bypass" },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { data?: PeerDownloadState[] };
        if (!cancelled && payload.data) {
          setPeers(payload.data);
        }
      } catch {
        // no-op: page can render empty graph until backend recovers
      }
    };

    void loadPeers();
    const timer = setInterval(loadPeers, 3500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  const graphPeers = useMemo<GraphPeer[]>(
    () =>
      peers.slice(0, 120).map((peer) => {
        const key = peer.peerId ?? `${peer.ip}:${peer.port}`;
        const activity = Math.min(1, (peer.pendingRequests + peer.piecesAvailable / 64 + (peer.downloadedBytes > 0 ? 1 : 0)) / 6);
        const stage = (peer.pendingRequests > 0 ? 3 : peer.choked ? 1 : 2) as 0 | 1 | 2 | 3 | 4;
        return {
          id: key,
          label: key,
          stage,
          activity,
          downloadLabel: `${(peer.downloadedBytes / 1024 / 1024).toFixed(1)} MB`,
          uploadLabel: `${peer.pendingRequests} req`,
        };
      }),
    [peers]
  );

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-5">
      <header className="mb-4 flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Swarm Graph</h1>
          <p className="text-xs text-foreground/60 font-mono">Session: {sessionId}</p>
        </div>
        <Link href={`/torrent/${sessionId}`} className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-secondary">
          Back to session
        </Link>
      </header>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 text-xs text-foreground/60 font-mono uppercase tracking-wider">
          Active peer graph ({graphPeers.length} visible)
        </div>
        <PeerGraph peers={graphPeers} />
      </section>
    </div>
  );
}
