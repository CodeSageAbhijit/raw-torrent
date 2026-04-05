"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PieceGrid from "@/components/piece-grid";
import { getBackendHttpUrl } from "@/lib/backend";

type PieceState = {
  index: number;
  hash: string;
  length: number;
  requested: boolean;
  completed: boolean;
};

type DownloadProgress = {
  piecesTotal: number;
  piecesCompleted: number;
};

export default function FullScreenPiecesPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const loadPieces = async () => {
      try {
        const [pieceResponse, progressResponse] = await Promise.all([
          fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/pieces`, {
            headers: { Authorization: "Bearer local-bypass" },
          }),
          fetch(`${getBackendHttpUrl()}/torrent/sessions/${sessionId}/progress`, {
            headers: { Authorization: "Bearer local-bypass" },
          }),
        ]);

        if (!pieceResponse.ok || !progressResponse.ok) {
          return;
        }

        const piecePayload = (await pieceResponse.json()) as { data?: PieceState[] };
        const progressPayload = (await progressResponse.json()) as { data?: DownloadProgress };

        if (!cancelled) {
          setPieces(piecePayload.data ?? []);
          setProgress(progressPayload.data ?? null);
        }
      } catch {
        // no-op: keep previous values until next poll
      }
    };

    void loadPieces();
    const timer = setInterval(loadPieces, 3500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  const totalPieces = useMemo(() => {
    if (typeof progress?.piecesTotal === "number" && progress.piecesTotal > 0) {
      return progress.piecesTotal;
    }
    return pieces.length;
  }, [progress?.piecesTotal, pieces.length]);

  const completedPieces = useMemo(() => {
    if (typeof progress?.piecesCompleted === "number") {
      return progress.piecesCompleted;
    }
    return pieces.filter((piece) => piece.completed).length;
  }, [progress?.piecesCompleted, pieces]);

  const sampledProgress = totalPieces > 0 ? (completedPieces / totalPieces) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-5">
      <header className="mb-4 flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Full Piece Map</h1>
          <p className="text-xs text-foreground/60 font-mono">Session: {sessionId}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-foreground/60">{sampledProgress.toFixed(1)}% complete</span>
          <Link href={`/torrent/${sessionId}`} className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-secondary">
            Back to session
          </Link>
        </div>
      </header>

      <section className="rounded-xl border bg-card p-4">
        <PieceGrid pieces={pieces} totalPieces={totalPieces} maxDisplay={Math.max(totalPieces, 1)} />
      </section>
    </div>
  );
}
