"use client";

import { useState, useCallback } from "react";

interface FileDownloaderProps {
  sessionId: string;
  fileName: string;
  fileSize: number;
  isComplete: boolean;
  backendUrl: string;
  authToken: string;
}

type DownloadStatus = "idle" | "downloading" | "success" | "error";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Check if File System Access API is available (modern browsers)
const hasFileSystemAccess = typeof window !== "undefined" && "showSaveFilePicker" in window;

export default function FileDownloader({
  sessionId,
  fileName,
  fileSize,
  isComplete,
  backendUrl,
  authToken,
}: FileDownloaderProps) {
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Download using modern File System Access API (Chrome, Edge)
  const downloadWithFileSystemAccess = useCallback(async () => {
    try {
      // Let user pick save location
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "Downloaded File",
            accept: { "application/octet-stream": [`.${fileName.split(".").pop() || "bin"}`] },
          },
        ],
      });

      setStatus("downloading");
      setDownloadProgress(0);

      // Fetch the file
      const response = await fetch(`${backendUrl}/torrent/sessions/${sessionId}/download`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Unable to read response body");
      }

      // Create writable stream to file
      const writable = await fileHandle.createWritable();
      
      let receivedBytes = 0;
      const contentLength = parseInt(response.headers.get("Content-Length") || String(fileSize), 10);

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        await writable.write(value);
        receivedBytes += value.length;
        setDownloadProgress(Math.round((receivedBytes / contentLength) * 100));
      }

      await writable.close();
      setStatus("success");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User cancelled
        setStatus("idle");
        return;
      }
      setError((err as Error).message);
      setStatus("error");
    }
  }, [sessionId, fileName, fileSize, backendUrl, authToken]);

  // Fallback download using Blob (works everywhere)
  const downloadWithBlob = useCallback(async () => {
    try {
      setStatus("downloading");
      setDownloadProgress(0);

      const response = await fetch(`${backendUrl}/torrent/sessions/${sessionId}/download`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Download failed: ${response.statusText}`);
      }

      // For blob download, we read the entire file into memory
      // This works for files up to a few hundred MB
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Unable to read response body");
      }

      const chunks: BlobPart[] = [];
      let receivedBytes = 0;
      const contentLength = parseInt(response.headers.get("Content-Length") || String(fileSize), 10);

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(new Blob([value]));
        receivedBytes += value.length;
        setDownloadProgress(Math.round((receivedBytes / contentLength) * 100));
      }

      // Create blob and download
      const blob = new Blob(chunks, { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      setStatus("success");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [sessionId, fileName, fileSize, backendUrl, authToken]);

  const handleDownload = useCallback(() => {
    setError(null);
    
    if (hasFileSystemAccess && fileSize > 50 * 1024 * 1024) {
      // Use File System Access for large files (>50MB)
      downloadWithFileSystemAccess();
    } else {
      // Use blob for smaller files or unsupported browsers
      downloadWithBlob();
    }
  }, [fileSize, downloadWithFileSystemAccess, downloadWithBlob]);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`
            h-10 w-10 rounded-lg flex items-center justify-center
            ${status === "success" ? "bg-green-500/20" : "bg-primary/20"}
          `}>
            {status === "success" ? (
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-semibold text-foreground truncate max-w-[300px]" title={fileName}>
              {fileName}
            </p>
            <p className="text-sm text-foreground/60 font-mono">{formatBytes(fileSize)}</p>
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={status === "downloading"}
          className={`
            px-5 py-2.5 rounded-lg font-semibold text-sm transition-all
            ${status === "downloading"
              ? "bg-secondary text-foreground/50 cursor-not-allowed"
              : status === "success"
                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20"
            }
          `}
        >
          {status === "downloading" ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {downloadProgress}%
            </span>
          ) : status === "success" ? (
            "Downloaded ✓"
          ) : isComplete ? (
            "Save to Device"
          ) : (
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              Stream Live to Device
            </span>
          )}
        </button>
      </div>

      {/* Download progress */}
      {status === "downloading" && (
        <div className="mt-4">
          <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Platform-specific notes */}
      {status === "idle" && (
        <p className="mt-3 text-xs text-foreground/40">
          {hasFileSystemAccess 
            ? "📁 Your browser supports direct file saving. You can choose where to save the file."
            : "📥 File will be saved to your default downloads folder."
          }
        </p>
      )}
    </div>
  );
}
