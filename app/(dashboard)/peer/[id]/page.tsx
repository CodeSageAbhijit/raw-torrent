import Link from "next/link";
import { peerSnapshots, formatSpeed } from "@/lib/mock-data";

export default async function PeerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const peer =
    peerSnapshots.find((entry) => entry.id === id) ?? peerSnapshots[0];

  return (
    <div className="flex-1 w-full flex flex-col items-center">

      <div className="flex flex-col gap-8 w-full max-w-5xl px-5 py-8">
        {/* Page Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary uppercase tracking-wider">
                Connected
              </span>
            </div>
            <h1 className="text-2xl font-medium font-mono">{peer.id}</h1>
            <p className="text-sm text-foreground/60 mt-1">
              {peer.ip} • {peer.client}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors"
          >
            ← Back
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border bg-primary/5 p-4">
            <p className="text-sm text-foreground/60">Download Speed</p>
            <p className="text-2xl font-semibold text-primary mt-1">
              {formatSpeed(peer.downloadMbps)}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-sm text-foreground/60">Upload Speed</p>
            <p className="text-2xl font-semibold mt-1">
              {formatSpeed(peer.uploadMbps)}
            </p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-sm text-foreground/60">Pieces Owned</p>
            <p className="text-2xl font-semibold mt-1">
              {peer.pieces}{" "}
              <span className="text-sm text-foreground/60">/ 256</span>
            </p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-sm text-foreground/60">Contribution</p>
            <p className="text-2xl font-semibold mt-1">{peer.contribution}%</p>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Piece Map */}
          <div className="lg:col-span-2 rounded-md border p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-medium">Piece Availability</h2>
                <p className="text-sm text-foreground/60">
                  {peer.pieces} of 256 pieces available
                </p>
              </div>
              <span className="text-xs font-mono px-2 py-1 rounded-md bg-secondary">
                {((peer.pieces / 256) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-16 gap-1">
              {Array.from({ length: 256 }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-sm transition-colors ${
                    i < peer.pieces ? "bg-primary" : "bg-secondary"
                  }`}
                  title={`Piece ${i + 1}: ${i < peer.pieces ? "Available" : "Missing"}`}
                />
              ))}
            </div>
          </div>

          {/* Connection Info */}
          <div className="space-y-6">
            <div className="rounded-md border p-6">
              <h3 className="font-medium mb-4">Connection Details</h3>
              <div className="space-y-3 text-sm">
                <InfoRow label="Protocol" value="BitTorrent v1.0" />
                <InfoRow label="Encryption" value="RC4" />
                <InfoRow label="Port" value="6881" />
                <InfoRow label="Connection Time" value="2h 34m" />
              </div>
            </div>

            <div className="rounded-md border p-6">
              <h3 className="font-medium mb-4">Transfer Statistics</h3>
              <div className="space-y-3 text-sm">
                <InfoRow label="Downloaded" value="3.2 GB" />
                <InfoRow label="Uploaded" value="7.8 GB" highlight />
                <InfoRow label="Ratio" value="2.44" />
                <InfoRow label="Messages" value="12,483" />
              </div>
            </div>
          </div>
        </div>

        {/* Bandwidth Graph Placeholder */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Bandwidth Over Time</h2>
          <div className="h-32 flex items-end gap-1">
            {Array.from({ length: 48 }).map((_, i) => {
              // Deterministic pseudo-random height based on index
              const pseudoRandom = (Math.sin(i * 12.9898) * 43758.5453) % 1;
              const height =
                20 + Math.sin(i * 0.3) * 40 + Math.abs(pseudoRandom) * 30;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-primary/60 hover:bg-primary transition-colors"
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-foreground/60">
            <span>24h ago</span>
            <span>Now</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-foreground/60">{label}</span>
      <span className={highlight ? "text-primary font-medium" : ""}>
        {value}
      </span>
    </div>
  );
}
