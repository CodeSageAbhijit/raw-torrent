"use client";

interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  activePeers: number;
  piecesCompleted: number;
  piecesTotal: number;
  eta: number;
  downloadSpeedMbps?: string;
  etaFormatted?: string;
}

interface ProgressBarProps {
  progress: DownloadProgress;
  fileName: string;
  status: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return `${(bytesPerSecond / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatEta(seconds: number): string {
  if (seconds < 0) return "calculating...";
  if (seconds === 0) return "done";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export default function DownloadProgressBar({ progress, fileName, status }: ProgressBarProps) {
  const progressPercent = Math.min(100, Math.max(0, progress.progress));
  const isComplete = status === "completed" || progressPercent >= 100;

  return (
    <div className="rounded-xl border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground truncate max-w-[400px]" title={fileName}>
            {fileName}
          </h2>
          <p className="text-sm text-foreground/60 font-mono mt-1">
            {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
          </p>
        </div>
        <div className={`
          px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider
          ${isComplete 
            ? "bg-green-500/20 text-green-400" 
            : "bg-primary/20 text-primary"
          }
        `}>
          {isComplete ? "Complete" : status}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative">
        <div className="w-full h-4 rounded-full bg-secondary overflow-hidden">
          <div 
            className={`
              h-full rounded-full transition-all duration-500 ease-out
              ${isComplete 
                ? "bg-green-500" 
                : "bg-gradient-to-r from-primary to-primary/80"
              }
            `}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        
        {/* Percentage overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold font-mono text-foreground drop-shadow-sm">
            {progressPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        <div className="p-3 rounded-lg bg-secondary/30">
          <p className="text-xs text-foreground/50 font-mono uppercase">Download Speed</p>
          <p className="text-lg font-bold text-primary font-mono mt-1">
            ↓ {formatSpeed(progress.downloadSpeed)}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-secondary/30">
          <p className="text-xs text-foreground/50 font-mono uppercase">Upload Speed</p>
          <p className="text-lg font-bold text-accent font-mono mt-1">
            ↑ {formatSpeed(progress.uploadSpeed)}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-secondary/30">
          <p className="text-xs text-foreground/50 font-mono uppercase">ETA</p>
          <p className="text-lg font-bold text-foreground font-mono mt-1">
            {progress.etaFormatted || formatEta(progress.eta)}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-secondary/30">
          <p className="text-xs text-foreground/50 font-mono uppercase">Pieces</p>
          <p className="text-lg font-bold text-foreground font-mono mt-1">
            {progress.piecesCompleted}/{progress.piecesTotal}
          </p>
        </div>
      </div>

      {/* Active Peers */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
          </span>
          <span className="text-sm font-mono text-foreground/70">
            {progress.activePeers} active peers
          </span>
        </div>
      </div>
    </div>
  );
}
