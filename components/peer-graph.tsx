"use client";

import { useMemo } from "react";

export interface GraphPeer {
  id: string;
  label: string;
  stage: 0 | 1 | 2 | 3 | 4;
  activity: number;
  downloadLabel: string;
  uploadLabel: string;
}

interface PeerGraphProps {
  peers: GraphPeer[];
}

const STAGE_COLORS: Record<number, string> = {
  0: "hsl(var(--muted-foreground))",
  1: "hsl(var(--accent))",
  2: "hsl(var(--primary))",
  3: "hsl(35 95% 52%)",
  4: "hsl(145 70% 45%)",
};

const ringForIndex = (index: number) => {
  if (index < 16) return { ring: 0, offset: index, count: 16 };
  if (index < 40) return { ring: 1, offset: index - 16, count: 24 };
  if (index < 76) return { ring: 2, offset: index - 40, count: 36 };
  return { ring: 3, offset: index - 76, count: Math.max(1, index - 75) };
};

export default function PeerGraph({ peers }: PeerGraphProps) {
  const centerX = 460;
  const centerY = 250;
  const rings = [80, 145, 210, 260];

  const nodes = useMemo(
    () =>
      peers.map((peer, index) => {
        const bucket = ringForIndex(index);
        const angle = (2 * Math.PI * bucket.offset) / bucket.count - Math.PI / 2;
        const radius = rings[bucket.ring] ?? rings[rings.length - 1];
        return {
          ...peer,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          stroke: STAGE_COLORS[peer.stage],
          size: 2 + Math.min(4, Math.round(peer.activity * 4)),
        };
      }),
    [peers]
  );

  return (
    <div className="relative w-full h-[420px] rounded-xl border bg-card overflow-hidden">
      <svg viewBox="0 0 920 500" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
        {rings.map((ring) => (
          <circle
            key={`ring-${ring}`}
            cx={centerX}
            cy={centerY}
            r={ring}
            fill="none"
            stroke="hsl(var(--border) / 0.5)"
            strokeDasharray="3 8"
          />
        ))}

        {nodes.map((node) => (
          <line
            key={`edge-${node.id}`}
            x1={centerX}
            y1={centerY}
            x2={node.x}
            y2={node.y}
            stroke={node.stroke}
            strokeOpacity={0.25 + node.activity * 0.4}
            strokeWidth={1 + node.activity * 0.7}
            strokeDasharray={node.stage >= 3 ? "1 0" : "4 6"}
          />
        ))}

        <circle cx={centerX} cy={centerY} r="13" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
        <circle cx={centerX} cy={centerY} r="20" fill="none" stroke="hsl(var(--primary) / 0.5)" strokeDasharray="3 5" />

        {nodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={node.size + 1.8} fill="hsl(var(--background))" stroke={node.stroke} strokeWidth="1.4" />
            <circle cx={node.x} cy={node.y} r={Math.max(1.8, node.size - 0.5)} fill={node.stroke} fillOpacity={0.9} />
          </g>
        ))}
      </svg>

      {peers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/50 font-mono">
          Waiting for active peers
        </div>
      )}

      <div className="absolute left-4 bottom-4 rounded-lg border bg-background/90 px-3 py-2 text-xs font-mono">
        <div className="text-foreground/60 mb-2 uppercase tracking-wider">Swarm Legend</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground/75">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" />discovered</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary" />handshake</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" />requesting</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" />verified</span>
        </div>
      </div>
    </div>
  );
}
