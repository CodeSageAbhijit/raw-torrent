"use client";

import { useState, useEffect } from "react";

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
  onConfirm: (selectedIndices: number[]) => void;
  onCancel: () => void;
}

export function FileSelectionModal({ files, isOpen, onConfirm, onCancel }: FileSelectionModalProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl border border-foreground/10 shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-foreground/10 p-6">
          <h2 className="text-2xl font-bold">Select Files to Download</h2>
          <p className="text-foreground/60 text-sm mt-2">
            Choose which files from this torrent you want to download
          </p>
        </div>

        {/* File List */}
        <div className="overflow-y-auto flex-1 p-6 space-y-2">
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

        {/* Footer */}
        <div className="border-t border-foreground/10 p-6 bg-foreground/[0.02]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-foreground/60">
                Total: <span className="font-semibold text-foreground">{formatBytes(totalSize)}</span>
              </p>
              {selectedIndices.size > 0 && (
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
              onClick={() => onConfirm(Array.from(selectedIndices))}
              disabled={selectedIndices.size === 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            >
              Download {selectedIndices.size > 0 && `(${selectedIndices.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
