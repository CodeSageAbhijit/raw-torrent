"use client";

import { useState, useEffect } from "react";
import { getBackendHttpUrl } from "@/lib/backend";

export interface FileInfo {
  index: number;
  name: string;
  path: string;
  length: number;
  selected: boolean;
}

interface FileSelectionModalProps {
  files: FileInfo[];
  isOpen: boolean;
  onConfirm: (selectedIndices: number[], savePath: string) => void;
  onCancel: () => void;
}

export function FileSelectionModal({ files, isOpen, onConfirm, onCancel }: FileSelectionModalProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [savePath, setSavePath] = useState("");

  useEffect(() => {
    // Initialize with all files selected
    setSelectedIndices(new Set(files.map((f) => f.index)));
  }, [files]);


  const toggleFile = (index: number) => {
    const newSet = new Set(selectedIndices);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedIndices(newSet);
  };

  const toggleAll = () => {
    if (selectedIndices.size === files.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(files.map((f) => f.index)));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const totalSize = files.reduce((sum, f) => sum + f.length, 0);
  const selectedSize = files
    .filter((f) => selectedIndices.has(f.index))
    .reduce((sum, f) => sum + f.length, 0);

  if (!isOpen) return null;

  const hasMultipleFiles = files.length > 1;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl border border-foreground/10 shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-foreground/10 p-6">
          <h2 className="text-2xl font-bold">
            {hasMultipleFiles ? "Select Files to Download" : "Download Location"}
          </h2>
          <p className="text-foreground/60 text-sm mt-2">
            {hasMultipleFiles
              ? "Choose which files from this torrent you want to download and where to save them"
              : "Choose where you want to save this download"}
          </p>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {/* Location Chooser */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Save Directory</label>
            <div className="flex gap-2">
              <div className="flex-1 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-all flex items-center justify-between">
                <span className="truncate">
                  {savePath ? savePath : <span className="text-foreground/40">Default Location</span>}
                </span>
                {savePath && (
                  <button
                    onClick={() => setSavePath("")}
                    className="ml-2 text-foreground/40 hover:text-foreground/80 transition-colors shrink-0"
                    title="Clear location"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`${getBackendHttpUrl()}/torrent/choose-directory`);
                    const data = await res.json();
                    if (data.path && !data.canceled) {
                      setSavePath(data.path);
                    }
                  } catch (err: any) {
                    console.error("Failed to pick directory:", err);
                  }
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors shrink-0 border border-border"
              >
                Browse...
              </button>
            </div>
          </div>

          {/* File List */}
          {hasMultipleFiles && (
            <div className="space-y-2">
              {/* Select All */}
              <div className="flex items-center gap-3 pb-4 border-b border-foreground/10">
                <input
                  type="checkbox"
                  id="select-all"
                  checked={selectedIndices.size === files.length && files.length > 0}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-foreground/30 cursor-pointer"
                />
                <label htmlFor="select-all" className="flex-1 cursor-pointer">
                  <span className="font-semibold">Select All</span>
                </label>
                <span className="text-xs text-foreground/50">{files.length} files</span>
              </div>

              {/* Individual Files */}
              {files.map((file) => (
                <div
                  key={file.index}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-foreground/5 transition-colors"
                >
                  <input
                    type="checkbox"
                    id={`file-${file.index}`}
                    checked={selectedIndices.has(file.index)}
                    onChange={() => toggleFile(file.index)}
                    className="w-4 h-4 rounded border-foreground/30 cursor-pointer"
                  />
                  <label htmlFor={`file-${file.index}`} className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        {file.path && file.path !== file.name && (
                          <p className="text-xs text-foreground/50 truncate">{file.path}</p>
                        )}
                      </div>
                      <span className="text-xs text-foreground/50 ml-2 whitespace-nowrap">
                        {formatBytes(file.length)}
                      </span>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-foreground/10 p-6 bg-foreground/[0.02]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-foreground/60">
                Total: <span className="font-semibold text-foreground">{formatBytes(totalSize)}</span>
              </p>
              {hasMultipleFiles && selectedIndices.size > 0 && (
                <p className="text-sm text-primary mt-1">
                  Selected: <span className="font-semibold">{formatBytes(selectedSize)}</span> ({selectedIndices.size} file
                  {selectedIndices.size !== 1 ? "s" : ""})
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/20 text-foreground hover:bg-foreground/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(Array.from(selectedIndices), savePath)}
              disabled={hasMultipleFiles && selectedIndices.size === 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              Download {hasMultipleFiles && selectedIndices.size > 0 && `(${selectedIndices.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
