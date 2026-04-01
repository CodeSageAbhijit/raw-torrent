"use client";

import { useState } from "react";

export default function PublishPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [trackerUrl, setTrackerUrl] = useState("udp://tracker.opentrackr.org:1337/announce");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setIsPublishing(true);
    // Simulate piece hashing and seed transition...
    setTimeout(() => {
      setIsPublishing(false);
      alert("Torrent successfully published & buffering to tracker!");
    }, 2000);
  };

  return (
    <div className="flex-1 w-full flex flex-col items-center min-h-screen bg-background text-foreground">

      <main className="flex flex-col gap-12 w-full max-w-5xl px-5 py-10 flex-1">
        <header className="animate-fade-in-up">
          <h1 className="text-3xl font-bold tracking-tight">Publish File</h1>
          <p className="text-foreground/60 mt-1.5 text-lg">
            Create a new torrent from your local files and begin seeding to the network.
          </p>
        </header>

        <section className="animate-fade-in-up delay-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-4 w-1 bg-accent rounded-full"></div>
            <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-widest font-mono">Store & Seed</h2>
          </div>
          <div className="rounded-xl border bg-card p-8 shadow-sm relative">
            <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none rounded-r-xl" />

            <form onSubmit={handlePublish} className="space-y-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl transition-all ${
                  isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-foreground/20 hover:border-primary/40 bg-card"
                }`}
              >
                <div className={`w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 ${isPublishing ? "animate-spin" : ""}`}>
                  <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                </div>
                {file ? (
                  <div className="text-center">
                    <p className="font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-foreground/50 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB • Ready to hash</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-medium text-foreground">Drag and drop file here</p>
                    <p className="text-xs text-foreground/50 mt-1">Select a file to generate a torrent</p>
                  </div>
                )}
                
                <input
                  type="file"
                  onChange={(e) => { if (e.target.files?.length) setFile(e.target.files[0]); }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={isPublishing}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Primary Tracker URL</label>
                <input
                  type="text"
                  value={trackerUrl}
                  onChange={(e) => setTrackerUrl(e.target.value)}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring/50 transition-all"
                  disabled={isPublishing}
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <p className="text-xs text-foreground/40">Encryption: Enforced RC4/MSE (Default)</p>
                <button
                  type="submit"
                  disabled={!file || isPublishing}
                  className="btn-animate rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPublishing ? "Hashing & Publishing..." : "Publish Torrent"}
                </button>
              </div>
            </form>

          </div>
        </section>
      </main>
    </div>
  );
}
