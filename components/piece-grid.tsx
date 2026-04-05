"use client";

import Link from "next/link";
import { useMemo } from "react";

interface PieceState {
  index: number;
  hash: string;
  length: number;
  requested: boolean;
  completed: boolean;
}

interface PieceGridProps {
  pieces: PieceState[];
  totalPieces: number;
  maxDisplay?: number;
  fullScreenHref?: string;
  tileSizePx?: number;
}

export default function PieceGrid({ pieces, totalPieces, maxDisplay = 500, fullScreenHref, tileSizePx = 8 }: PieceGridProps) {
  const displayPieces = useMemo(() => {
    // If more pieces than we can display, sample them
    if (totalPieces <= maxDisplay) {
      return pieces;
    }

    // Build a quick lookup map for fast access
    const pieceMap = new Map(pieces.map(p => [p.index, p]));
    
    // Sample pieces evenly
    const step = totalPieces / maxDisplay;
    const sampled: PieceState[] = [];
    for (let i = 0; i < maxDisplay; i++) {
      const index = Math.floor(i * step);
      const piece = pieceMap.get(index);
      if (piece) {
        sampled.push(piece);
      } else {
        sampled.push({
          index,
          hash: "",
          length: 0,
          requested: false,
          completed: false,
        });
      }
    }
    return sampled;
  }, [pieces, totalPieces, maxDisplay]);

  const { completedCount, requestedCount } = useMemo(() => {
    let completed = 0;
    let requested = 0;
    for (let i = 0; i < pieces.length; i++) {
        if (pieces[i].completed) completed++;
        else if (pieces[i].requested) requested++;
    }
    return { completedCount: completed, requestedCount: requested };
  }, [pieces]);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-1 bg-primary rounded-full" />
          <h3 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">
            Piece Map
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-primary" />
            Complete ({completedCount})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-yellow-500 animate-pulse" />
            Downloading ({requestedCount})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-secondary" />
            Pending ({totalPieces - completedCount - requestedCount})
          </span>
          {fullScreenHref && (
            <Link
              href={fullScreenHref}
              className="inline-flex items-center justify-center rounded-md border p-1.5 text-foreground/70 hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Open full screen pieces view"
              title="Full screen pieces"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="M3 10V3h7v2H5v5H3zm16-5h-5V3h7v7h-2V5zM5 14v5h5v2H3v-7h2zm16 0h2v7h-7v-2h5v-5z" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      <div 
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${tileSizePx}px, 1fr))`,
        }}
      >
        {displayPieces.map((piece) => (
          <div
            key={piece.index}
            className={`
              aspect-square rounded-sm transition-colors duration-200
              ${piece.completed 
                ? "bg-primary" 
                : piece.requested 
                  ? "bg-yellow-500 animate-pulse" 
                  : "bg-secondary"
              }
            `}
            title={`Piece ${piece.index}: ${piece.completed ? "Complete" : piece.requested ? "Downloading" : "Pending"}`}
          />
        ))}
      </div>

      {totalPieces > maxDisplay && (
        <p className="text-xs text-foreground/50 mt-3 font-mono">
          Showing {maxDisplay} of {totalPieces} pieces (sampled view)
        </p>
      )}
    </div>
  );
}
