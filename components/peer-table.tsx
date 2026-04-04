"use client";

interface PeerDownloadState {
  ip: string;
  port: number;
  peerId?: string;
  choked: boolean;
  piecesAvailable: number;
  downloadedBytes: number;
  pendingRequests: number;
}

interface PeerTableProps {
  peers: PeerDownloadState[];
  totalPieces: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function PeerTable({ peers = [], totalPieces = 1 }: PeerTableProps) {     
  const sortedPeers = [...peers].sort((a, b) => b.downloadedBytes - a.downloadedBytes);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-3 p-5 border-b">
        <div className="h-4 w-1 bg-primary rounded-full" />
        <h3 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">
          Connected Peers ({peers.length})
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-secondary/30">
              <th className="text-left p-3 font-mono font-medium text-foreground/60">Status</th>
              <th className="text-left p-3 font-mono font-medium text-foreground/60">IP Address</th>
              <th className="text-left p-3 font-mono font-medium text-foreground/60">Pieces</th>
              <th className="text-left p-3 font-mono font-medium text-foreground/60">Downloaded</th>
              <th className="text-left p-3 font-mono font-medium text-foreground/60">Requests</th>
            </tr>
          </thead>
          <tbody>
            {sortedPeers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-5 text-center text-foreground/50 font-mono">
                  No peers connected yet...
                </td>
              </tr>
            ) : (
              sortedPeers.map((peer, index) => (
                <tr
                  key={peer?.peerId || `${peer?.ip}-${peer?.port}-${index}`}
                  className={`border-b last:border-0 hover:bg-secondary/20 transition-colors ${
                    index < 3 ? "bg-primary/5" : ""
                  }`}
                >
                  <td className="p-3">
                    <span className={`
                      inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono font-medium
                      ${peer.choked 
                        ? "bg-red-500/20 text-red-400" 
                        : "bg-green-500/20 text-green-400"
                      }
                    `}>
                      <span className={`w-1.5 h-1.5 rounded-full ${peer.choked ? "bg-red-400" : "bg-green-400"}`} />
                      {peer.choked ? "Choked" : "Active"}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-foreground/80">
                    {peer.ip}:{peer.port}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${(peer.piecesAvailable / totalPieces) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-foreground/60">
                        {peer.piecesAvailable}/{totalPieces}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-foreground/80">
                    {formatBytes(peer.downloadedBytes)}
                  </td>
                  <td className="p-3">
                    <span className={`
                      font-mono text-xs px-2 py-0.5 rounded
                      ${peer.pendingRequests > 0 
                        ? "bg-yellow-500/20 text-yellow-400" 
                        : "bg-secondary text-foreground/50"
                      }
                    `}>
                      {peer.pendingRequests} pending
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
