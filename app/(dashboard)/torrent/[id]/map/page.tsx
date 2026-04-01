"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import InteractiveMap from "../interactive-map";
import { peerSnapshots, sessions } from "@/lib/mock-data";

const LOCAL_CLIENT_COORD: [number, number] = [-74.006, 40.7128]; // NY

export default function FullScreenMapPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];

  return (
    <div className="flex-1 w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header overlay */}
      <header className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between p-4 rounded-xl border bg-background/80 backdrop-blur-sm shadow-md">
        <div className="flex items-center gap-3">
          <Link
            href={`/torrent/${sessionId}`}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border text-foreground hover:bg-secondary transition-colors"
          >
            ← Back to Analytics
          </Link>
          <div className="h-4 w-1 bg-primary rounded-full hidden sm:block"></div>
          <h1 className="text-lg font-bold tracking-tight hidden sm:block">
            {session.name} <span className="text-foreground/50 font-mono text-sm ml-2">Global Network</span>
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-secondary text-foreground/70 font-medium">
             {peerSnapshots.length} Active Nodes
          </span>
        </div>
      </header>

      {/* Full screen map */}
      <main className="flex-1 w-full h-full relative">
        <InteractiveMap peerSnapshots={peerSnapshots} localCoord={LOCAL_CLIENT_COORD} />

        {/* Legend Overlay */}
        <div className="absolute bottom-6 left-6 z-10 rounded-lg border bg-background/80 backdrop-blur-sm p-4 shadow-md flex flex-col gap-3">
           <p className="text-xs font-bold text-foreground/50 uppercase tracking-wider font-mono border-b pb-2 mb-1">Legend</p>
           <div className="flex items-center gap-2 text-sm font-mono font-medium text-foreground/80">
              <span className="w-3 h-3 rounded-full bg-foreground border border-background"></span> Local Client
           </div>
           <div className="flex items-center gap-2 text-sm font-mono font-medium text-foreground/80">
              <span className="w-3 h-3 rounded-full bg-primary"></span> RC4/MSE Encrypted
           </div>
           <div className="flex items-center gap-2 text-sm font-mono font-medium text-foreground/80">
              <span className="w-3 h-3 rounded-full bg-accent"></span> Plaintext Data
           </div>
           <div className="text-[10px] text-foreground/50 mt-2 max-w-[200px]">
              Scroll to zoom. Click & drag to pan. Hover nodes for details.
           </div>
        </div>
      </main>
    </div>
  );
}
