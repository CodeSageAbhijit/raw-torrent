"use client";

import { useMemo, useState } from "react";

export interface GraphPeer {
  id: string;
  label: string;
  stage: 0 | 1 | 2 | 3 | 4;
  activity: number;
  downloadLabel: string;
  uploadLabel: string;
  pendingRequests?: number;
  piecesAvailable?: number;
}

interface PeerGraphProps {
  peers: GraphPeer[];
  showGuide?: boolean;
  monochromeLinks?: boolean;
  animatedLinks?: boolean;
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

export default function PeerGraph({
  peers,
  showGuide = true,
  monochromeLinks = false,
  animatedLinks = true,
}: PeerGraphProps) {
  const centerX = 460;
  const centerY = 250;
  const rings = [80, 145, 210, 260];
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [hoveredPeerId, setHoveredPeerId] = useState<string>("");

  const activePeerId = hoveredPeerId || selectedPeerId;

  const stageLabel = (stage: GraphPeer["stage"]) => {
    if (stage === 0) return "Seen";
    if (stage === 1) return "Handshake";
    if (stage === 2) return "Connected";
    if (stage === 3) return "Fetching";
    return "Verified";
  };

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

  const activeNode = useMemo(() => nodes.find((node) => node.id === activePeerId) ?? null, [nodes, activePeerId]);

  const fetchingCount = useMemo(() => peers.filter((peer) => peer.stage >= 3).length, [peers]);

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

        {nodes.map((node, index) => (
          <line
            key={`edge-${node.id}`}
            x1={centerX}
            y1={centerY}
            x2={node.x}
            y2={node.y}
            className={animatedLinks ? "topology-line-animated" : undefined}
            style={animatedLinks ? { animationDelay: `${(index % 8) * 0.18}s` } : undefined}
            stroke={monochromeLinks ? "hsl(var(--foreground) / 0.38)" : node.stroke}
            strokeOpacity={
              activePeerId
                ? node.id === activePeerId
                  ? 0.85
                  : 0.1
                : monochromeLinks
                  ? 0.32
                  : 0.25 + node.activity * 0.4
            }
            strokeWidth={
              activePeerId
                ? node.id === activePeerId
                  ? 2.2
                  : 0.8
                : monochromeLinks
                  ? 1.2
                  : 1 + node.activity * 0.7
            }
            strokeDasharray={monochromeLinks ? "3 6" : node.stage >= 3 ? "1 0" : "4 6"}
          />
        ))}

        <circle cx={centerX} cy={centerY} r="13" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
        <circle cx={centerX} cy={centerY} r="20" fill="none" stroke="hsl(var(--primary) / 0.5)" strokeDasharray="3 5" />

        {nodes.map((node) => (
          <g
            key={node.id}
            onMouseEnter={() => setHoveredPeerId(node.id)}
            onMouseLeave={() => setHoveredPeerId("")}
            onClick={() => setSelectedPeerId((current) => (current === node.id ? "" : node.id))}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={activePeerId === node.id ? node.size + 4 : node.size + 1.8}
              fill="hsl(var(--background))"
              stroke={node.stroke}
              strokeWidth={activePeerId === node.id ? "2.2" : "1.4"}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={Math.max(1.8, node.size - 0.5)}
              fill={node.stroke}
              fillOpacity={activePeerId && activePeerId !== node.id ? 0.35 : 0.9}
            />
            {node.stage >= 3 && (
              <circle cx={node.x} cy={node.y} r={node.size + 7} fill="none" stroke={node.stroke} strokeOpacity="0.25" strokeWidth="1" className="animate-ping" />
            )}
          </g>
        ))}
      </svg>

      {peers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/50 font-mono">
          Waiting for active peers
        </div>
      )}

      {showGuide && (
        <div className="absolute left-4 bottom-4 rounded-lg border bg-background/90 px-3 py-2 text-xs font-mono max-w-[320px]">
          <div className="text-foreground/60 mb-2 uppercase tracking-wider">How To Read This</div>
          <div className="text-foreground/75 space-y-1">
            <p>Center node = your downloader.</p>
            <p>Outer nodes = peers in the swarm.</p>
            <p>Brighter/thicker lines = more active data fetch.</p>
            <p>Click a node to pin details.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground/75 mt-2">
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" />seen</span>
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary" />handshake</span>
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500" />fetching</span>
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" />verified</span>
          </div>
        </div>
      )}

      <div className="absolute right-4 top-4 rounded-lg border bg-background/90 px-3 py-2 text-xs font-mono min-w-[220px]">
        <p className="text-foreground/60 uppercase tracking-wider mb-1">Live Fetch Summary</p>
        <p className="text-foreground/80">Peers visible: {peers.length}</p>
        <p className="text-foreground/80">Peers fetching now: {fetchingCount}</p>
      </div>

      {activeNode && (
        <div className="absolute right-4 bottom-4 rounded-lg border bg-background/95 px-3 py-2 text-xs font-mono min-w-[240px]">
          <p className="text-foreground/60 uppercase tracking-wider mb-1">Selected Peer</p>
          <p className="truncate text-foreground/85" title={activeNode.label}>{activeNode.label}</p>
          <p className="text-foreground/80 mt-1">State: {stageLabel(activeNode.stage)}</p>
          <p className="text-foreground/80">Downloaded: {activeNode.downloadLabel}</p>
          <p className="text-foreground/80">Requests: {activeNode.uploadLabel}</p>
          {typeof activeNode.piecesAvailable === "number" && <p className="text-foreground/80">Pieces available: {activeNode.piecesAvailable}</p>}
        </div>
      )}
    </div>
  );
}
