"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getBackendHttpUrl } from "@/lib/backend";
import { FileSelectionModal, type FileInfo } from "./file-selection-modal";

export function StartSessionForm() {
  const router = useRouter();
  const [magnet, setMagnet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // File selection modal state
  const [showFileSelectionModal, setShowFileSelectionModal] = useState(false);
  const [torrentFiles, setTorrentFiles] = useState<FileInfo[]>([]);
  const [pendingFormData, setPendingFormData] = useState<{ file?: File; magnet: string } | null>(null);

  const parseAndShowFiles = async (torrentFile: File | null, magnetUri: string) => {
    setError(null);
    setIsUploading(true);

    try {
      const trimmedMagnet = magnetUri.trim();

      if (!torrentFile && !trimmedMagnet) {
        throw new Error("Provide a magnet link or torrent file");
      }

      // Parse torrent to get file list
      const parseEndpoint = `${getBackendHttpUrl()}/torrent/parse`;
      let parseResponse: Response;

      if (torrentFile) {
        const formData = new FormData();
        formData.append("torrentFile", torrentFile);

        if (trimmedMagnet) {
          formData.append("magnetUri", trimmedMagnet);
        }

        parseResponse = await fetch(parseEndpoint, {
          method: "POST",
          body: formData,
        });
      } else {
        parseResponse = await fetch(parseEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            magnetUri: trimmedMagnet,
          }),
        });
      }

      const parsePayload = (await parseResponse.json()) as {
        success: boolean;
        error?: string;
        data?: {
          files: FileInfo[];
          isMultiFile: boolean;
        };
      };

      if (!parseResponse.ok) {
        throw new Error(parsePayload.error ?? "Failed to parse torrent");
      }

      if (!parsePayload.success || !parsePayload.data?.files) {
        throw new Error("Failed to get file list from torrent");
      }

      setTorrentFiles(parsePayload.data.files);
      setPendingFormData({ file: torrentFile ?? undefined, magnet: trimmedMagnet });

      // Only show modal for multi-file torrents
      if (parsePayload.data.isMultiFile && parsePayload.data.files.length > 1) {
        setShowFileSelectionModal(true);
      } else {
        // Single file, start directly
        await startDownload(torrentFile, trimmedMagnet, undefined);
      }
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Unable to parse torrent";
      setError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const startDownload = async (torrentFile: File | null, magnetUri: string, selectedFileIndices?: number[]) => {
    setError(null);
    setIsUploading(true);
    setShowFileSelectionModal(false);

    try {
      const trimmedMagnet = magnetUri.trim();
      const endpoint = `${getBackendHttpUrl()}/torrent/start`;
      let response: Response;

      if (torrentFile) {
        const formData = new FormData();
        formData.append("torrentFile", torrentFile);

        if (trimmedMagnet) {
          formData.append("magnetUri", trimmedMagnet);
        }

        if (selectedFileIndices && selectedFileIndices.length > 0) {
          formData.append("selectedFileIndices", JSON.stringify(selectedFileIndices));
        }

        response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });
      } else {
        const body: any = {
          magnetUri: trimmedMagnet,
        };

        if (selectedFileIndices && selectedFileIndices.length > 0) {
          body.selectedFileIndices = selectedFileIndices;
        }

        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }

      const payload = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: {
          sessionId: string;
        };
      };

      if (!response.ok) {
        const errorMsg = payload.error ?? `Failed to start session (${response.status})`;
        throw new Error(errorMsg);
      }

      if (!payload.success || !payload.data?.sessionId) {
        throw new Error(payload.error ?? "Failed to start backend torrent session");
      }

      router.push(`/torrent/${payload.data.sessionId}`);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Unable to start session";
      setError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const startSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await parseAndShowFiles(file, magnet);
  };

  const handleFileSelectionConfirm = (selectedIndices: number[]) => {
    if (pendingFormData) {
      startDownload(pendingFormData.file ?? null, pendingFormData.magnet, selectedIndices);
    }
  };

  const handleFileSelectionCancel = () => {
    setShowFileSelectionModal(false);
    setPendingFormData(null);
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
    <>
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
              <p className="text-sm text-foreground/50 mt-1">{isUploading ? "Reading file list" : "or click to browse"}</p>
            </div>
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
            {isUploading ? "Analyzing..." : "Start Session →"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-600">⚠️ Unable to Start Session</p>
                <p className="text-sm text-red-600/80 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
      </form>

      {/* File Selection Modal */}
      <FileSelectionModal
        files={torrentFiles}
        isOpen={showFileSelectionModal}
        onConfirm={handleFileSelectionConfirm}
        onCancel={handleFileSelectionCancel}
      />
    </>
  );
}
