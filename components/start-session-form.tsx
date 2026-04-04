"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getBackendHttpUrl } from "@/lib/backend";

export function StartSessionForm() {
  const router = useRouter();
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsUploading(true);

    try {
      const trimmedMagnet = magnet.trim();

      if (!file && !trimmedMagnet) {
        throw new Error("Provide a magnet link or torrent file");
      }

      const endpoint = `${getBackendHttpUrl()}/torrent/start`;
      let response: Response;

      if (file) {
        const formData = new FormData();
        formData.append("torrentFile", file);

        if (trimmedMagnet) {
          formData.append("magnetUri", trimmedMagnet);
        }

        response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            magnetUri: trimmedMagnet,
          }),
        });
      }

      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: {
          sessionId: string;
        };
      };

      if (!response.ok || !payload.success || !payload.data?.sessionId) {
        throw new Error(payload.error ?? "Failed to start backend torrent session");
      }

      router.push(`/torrent/${payload.data.sessionId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to start session");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".torrent")) {
      setFile(file);
      setFileName(file.name);
    }
  };

  return (
    <form onSubmit={startSession} className="space-y-6">
      {/* File Upload Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative rounded-xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
          isDragging
            ? "dropzone-active border-primary bg-primary/5 scale-[1.01]"
            : isUploading
              ? "border-primary/50 bg-primary/5"
              : "border-input hover:border-primary/40 hover:bg-primary/[0.02]"
        }`}
      >
        <input
          type="file"
          accept=".torrent"
          onChange={(e) => {
            const selectedFile = e.target.files?.[0] ?? null;
            setFile(selectedFile);
            setFileName(selectedFile?.name ?? "");
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center transition-transform duration-300 ${isDragging ? "scale-110 animate-pulse-glow" : ""} ${isUploading ? "animate-float" : ""}`}>
            {isUploading ? (
              <svg className="w-6 h-6 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-medium">{isUploading ? "Analyzing torrent..." : fileName || "Drop .torrent file here"}</p>
            <p className="text-sm text-foreground/50 mt-1">{isUploading ? "Setting up peer connections" : "or click to browse"}</p>
          </div>
          {/* Upload progress bar */}
          {isUploading && (
            <div className="w-48 h-1.5 rounded-full bg-secondary overflow-hidden mt-2">
              <div className="h-full rounded-full bg-primary progress-animated" style={{ width: "70%", transition: "width 0.8s ease" }} />
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-foreground/10" />
        <span className="text-xs text-foreground/40 uppercase tracking-wider">or paste magnet</span>
        <div className="flex-1 h-px bg-foreground/10" />
      </div>

      {/* Magnet Link Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Magnet Link</label>
        <textarea
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
          rows={3}
          placeholder="magnet:?xt=urn:btih:..."
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-all"
        />
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground/50">
          {fileName ? `Selected: ${fileName}` : "Ready to start"}
        </p>
        <button
          type="submit"
          disabled={(!fileName && !magnet.trim()) || isUploading}
          className="btn-animate rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {isUploading ? "Starting..." : "Start Session →"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive font-medium">{error}</p>
      )}
    </form>
  );
}
