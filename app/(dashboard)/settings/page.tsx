
"use client";

import { useEffect, useState } from "react";

interface Settings {
  port: number;
  maxPeers: number;
  downloadLimit: number;
  uploadLimit: number;
  maxRequestsPerPeer: number;
  requestTimeoutMs: number;
  trackerAnnounceInterval: number;
  trackerNumwant: number;
  autoPickBestPeers: boolean;
  enablePEX: boolean;
  enableDHT: boolean;
  pieceSelectionStrategy: "sequential" | "random" | "rarest-first";
  peerConnectionTimeoutMs: number;
  turboMode: boolean;
  adaptiveTuning: boolean;
  extraTrackers: string[];
}

// High-speed stable defaults for long-running sessions.
const DEFAULT_SETTINGS: Settings = {
  port: 6881,
  maxPeers: 120,
  downloadLimit: 12288,
  uploadLimit: 1024,
  maxRequestsPerPeer: 20,
  requestTimeoutMs: 20000,
  trackerAnnounceInterval: 45,
  trackerNumwant: 350,
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: true,
  pieceSelectionStrategy: "rarest-first",
  peerConnectionTimeoutMs: 12000,
  turboMode: true,
  adaptiveTuning: true,
  extraTrackers: [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
  ],
};

// Extra-aggressive speed profile with stability guardrails.
const SPEED_PRESET: Settings = {
  port: 6881,
  maxPeers: 160,
  downloadLimit: 12288,
  uploadLimit: 1536,
  maxRequestsPerPeer: 24,
  requestTimeoutMs: 17000,
  trackerAnnounceInterval: 35,
  trackerNumwant: 450,
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: true,
  pieceSelectionStrategy: "sequential",
  peerConnectionTimeoutMs: 10000,
  turboMode: true,
  adaptiveTuning: true,
  extraTrackers: [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://9.rarbg.to:2710/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "https://tracker.opentrackr.org:443/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://tracker.publicbt.com:80/announce",
    "udp://tracker.1337x.com:6969/announce",
    "udp://tracker.zer0day.to:1337/announce",
  ],
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTrackerUrl, setNewTrackerUrl] = useState("");

  // Fetch settings from backend on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setSettings({ ...DEFAULT_SETTINGS, ...data });
        } else {
          setSettings(DEFAULT_SETTINGS);
        }
      } catch (e) {
        console.error("Failed to fetch settings:", e);
        setSettings(DEFAULT_SETTINGS);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to save settings");
      }
    } catch (e) {
      setError("Failed to save settings. Check your connection.");
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      turboMode: settings.turboMode,
    };

    setSettings(nextSettings);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to reset settings:", e);
    }
  };

  const handleApplySpeedPreset = async () => {
    const nextSettings = {
      ...SPEED_PRESET,
      turboMode: settings.turboMode,
    };

    setSettings(nextSettings);
    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error("Failed to apply preset:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTracker = () => {
    if (!newTrackerUrl.trim()) {
      setError("Tracker URL cannot be empty");
      return;
    }

    if (!newTrackerUrl.startsWith("udp://") && !newTrackerUrl.startsWith("http://") && !newTrackerUrl.startsWith("https://")) {
      setError("Tracker URL must start with udp://, http://, or https://");
      return;
    }

    if (settings.extraTrackers.includes(newTrackerUrl)) {
      setError("This tracker is already added");
      return;
    }

    setSettings({
      ...settings,
      extraTrackers: [...settings.extraTrackers, newTrackerUrl],
    });
    setNewTrackerUrl("");
    setError(null);
  };

  const handleRemoveTracker = (index: number) => {
    setSettings({
      ...settings,
      extraTrackers: settings.extraTrackers.filter((_, i) => i !== index),
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center">
        <div className="text-foreground/60">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full flex flex-col items-center">
      <div className="flex flex-col gap-8 w-full max-w-5xl px-5 py-8">
        <div>
          <h1 className="text-2xl font-medium">Settings</h1>
          <p className="text-sm text-foreground/60 mt-1">
            Manage your torrent application preferences and optimization parameters
          </p>
          <p className="text-xs text-foreground/50 mt-2">
            💾 Settings are synced to the backend. Some changes may require restarting the application to take full effect.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Connection Settings */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Connection</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="port" className="text-sm font-medium">
                Listening Port
              </label>
              <input
                id="port"
                type="number"
                value={settings.port}
                onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Port for incoming peer connections (6881-6889 standard)</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="maxPeers" className="text-sm font-medium">
                Max Peers per Torrent
              </label>
              <input
                id="maxPeers"
                type="number"
                value={settings.maxPeers}
                onChange={(e) => setSettings({ ...settings, maxPeers: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Maximum simultaneous peer connections (default: 120)</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="maxRequestsPerPeer" className="text-sm font-medium">
                Max Concurrent Requests per Peer
              </label>
              <input
                id="maxRequestsPerPeer"
                type="number"
                value={settings.maxRequestsPerPeer}
                onChange={(e) => setSettings({ ...settings, maxRequestsPerPeer: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Number of piece requests sent to each peer before waiting for responses</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="requestTimeoutMs" className="text-sm font-medium">
                Request Timeout (milliseconds)
              </label>
              <input
                id="requestTimeoutMs"
                type="number"
                value={settings.requestTimeoutMs}
                onChange={(e) => setSettings({ ...settings, requestTimeoutMs: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">How long to wait before marking a request as timed out</p>
            </div>
          </div>
        </div>

        {/* Bandwidth Settings */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Bandwidth</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="downloadLimit" className="text-sm font-medium">
                Download Limit (KB/s)
              </label>
              <input
                id="downloadLimit"
                type="number"
                value={settings.downloadLimit}
                onChange={(e) => setSettings({ ...settings, downloadLimit: Number(e.target.value) })}
                placeholder="12288"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">SSD Safety Guard enforces a backend hard cap even if this is set higher.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="uploadLimit" className="text-sm font-medium">
                Upload Limit (KB/s)
              </label>
              <input
                id="uploadLimit"
                type="number"
                value={settings.uploadLimit}
                onChange={(e) => setSettings({ ...settings, uploadLimit: Number(e.target.value) })}
                placeholder="0 = unlimited"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Set to 0 for unlimited speed</p>
            </div>
          </div>
        </div>

        {/* Tracker Settings */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Tracker & Discovery</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="trackerAnnounceInterval" className="text-sm font-medium">
                Tracker Refresh Interval (seconds)
              </label>
              <input
                id="trackerAnnounceInterval"
                type="number"
                value={settings.trackerAnnounceInterval}
                onChange={(e) => setSettings({ ...settings, trackerAnnounceInterval: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">How often to refresh peer list from trackers (seconds)</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="trackerNumwant" className="text-sm font-medium">
                Tracker Numwant (peers per request)
              </label>
              <input
                id="trackerNumwant"
                type="number"
                value={settings.trackerNumwant}
                onChange={(e) => setSettings({ ...settings, trackerNumwant: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Max peers to request from tracker per announce (max ~500)</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="peerConnectionTimeoutMs" className="text-sm font-medium">
                Peer Connection Timeout (milliseconds)
              </label>
              <input
                id="peerConnectionTimeoutMs"
                type="number"
                value={settings.peerConnectionTimeoutMs}
                onChange={(e) => setSettings({ ...settings, peerConnectionTimeoutMs: Number(e.target.value) })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <p className="text-xs text-foreground/50">Connection timeout for peer handshakes (milliseconds)</p>
            </div>

            <div className="flex items-center gap-3 py-2">
              <input
                id="enablePEX"
                type="checkbox"
                checked={settings.enablePEX}
                onChange={(e) => setSettings({ ...settings, enablePEX: e.target.checked })}
                className="h-4 w-4 rounded border border-input"
              />
              <label htmlFor="enablePEX" className="text-sm font-medium cursor-pointer">
                Enable Peer Exchange (PEX)
              </label>
            </div>

            <div className="flex items-center gap-3 py-2">
              <input
                id="enableDHT"
                type="checkbox"
                checked={settings.enableDHT}
                onChange={(e) => setSettings({ ...settings, enableDHT: e.target.checked })}
                className="h-4 w-4 rounded border border-input"
              />
              <label htmlFor="enableDHT" className="text-sm font-medium cursor-pointer">
                Enable DHT (Distributed Hash Table)
              </label>
            </div>
          </div>
        </div>

        {/* Tracker Management */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">📡 Extra Trackers</h2>
          <p className="text-sm text-foreground/60 mb-4">
            Add custom tracker servers to improve peer discovery and download speeds. Trackers help your client find peers sharing the file.
          </p>
          
          <div className="space-y-4">
            {/* Add Tracker Form */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTrackerUrl}
                onChange={(e) => setNewTrackerUrl(e.target.value)}
                placeholder="e.g., udp://tracker.example.com:6969/announce"
                className="flex flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
              <button
                onClick={handleAddTracker}
                className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
            </div>

            {/* Current Trackers List */}
            {settings.extraTrackers.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground/60">{settings.extraTrackers.length} tracker(s) configured</p>
                {settings.extraTrackers.map((tracker, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-md border border-foreground/10 bg-foreground/2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-foreground/80 truncate">{tracker}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveTracker(index)}
                      className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-foreground/10 text-foreground/60 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/20 transition-colors flex-shrink-0"
                      title="Remove tracker"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-foreground/20 p-4 text-center">
                <p className="text-sm text-foreground/50">No extra trackers configured. Click Add to get started.</p>
              </div>
            )}
          </div>
        </div>

        {/* Performance Settings */}
        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Performance</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="pieceSelectionStrategy" className="text-sm font-medium">
                Piece Selection Strategy
              </label>
              <select
                id="pieceSelectionStrategy"
                value={settings.pieceSelectionStrategy}
                onChange={(e) => setSettings({ ...settings, pieceSelectionStrategy: e.target.value as "sequential" | "random" | "rarest-first" })}
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              >
                <option value="rarest-first">Rarest First (Default)</option>
                <option value="sequential">Sequential</option>
                <option value="random">Random</option>
              </select>
              <p className="text-xs text-foreground/50">Strategy for selecting which pieces to download</p>
            </div>

            <div className="flex items-center gap-3 py-2">
              <input
                id="autoPickBestPeers"
                type="checkbox"
                checked={settings.autoPickBestPeers}
                onChange={(e) => setSettings({ ...settings, autoPickBestPeers: e.target.checked })}
                className="h-4 w-4 rounded border border-input"
              />
              <label htmlFor="autoPickBestPeers" className="text-sm font-medium cursor-pointer">
                Auto-select Best Peers (fastest peers prioritized)
              </label>
            </div>

            <div className="flex items-center gap-3 py-2">
              <input
                id="adaptiveTuning"
                type="checkbox"
                checked={settings.adaptiveTuning}
                onChange={(e) => setSettings({ ...settings, adaptiveTuning: e.target.checked })}
                className="h-4 w-4 rounded border border-input"
              />
              <label htmlFor="adaptiveTuning" className="text-sm font-medium cursor-pointer">
                Adaptive Tuning (auto-adjust requests and strategy from live speed)
              </label>
            </div>
          </div>
        </div>

        {/* Presets */}
        <div className="rounded-md border p-6 bg-gradient-to-br from-primary/8 to-primary/3">
          <h2 className="font-medium mb-4">⚡ Quick Presets</h2>
          <p className="text-sm text-foreground/60 mb-4">
            Choose a preset to quickly optimize for different scenarios. Your custom changes will be overwritten.
          </p>
          
          <div className="space-y-3">
            {/* Speed Preset */}
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-semibold text-primary">⚡ High-Speed Stable</h3>
                  <p className="text-xs text-foreground/60 mt-1">
                    Faster profile tuned for long runs without overwhelming disk and memory.
                  </p>
                  <ul className="text-xs text-foreground/50 mt-2 space-y-0.5">
                    <li>✓ Max Peers: 160 (vs 120)</li>
                    <li>✓ Requests/Peer: 24 (vs 20)</li>
                    <li>✓ Tracker Refresh: 35s (vs 45s)</li>
                    <li>✓ Upload cap: 1536 KB/s</li>
                  </ul>
                </div>
                <button
                  onClick={handleApplySpeedPreset}
                  disabled={isSaving}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* Default Preset */}
            <div className="rounded-md border border-primary/20 bg-primary/4 p-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="font-semibold text-primary">⚖️ Default Long-Run Stable</h3>
                  <p className="text-xs text-foreground/60 mt-1">
                    Strong throughput with lower churn for 24/7 sessions.
                  </p>
                  <ul className="text-xs text-foreground/50 mt-2 space-y-0.5">
                    <li>• Max Peers: 120</li>
                    <li>• Requests/Peer: 20</li>
                    <li>• Tracker Refresh: 45s</li>
                    <li>• Piece Strategy: Rarest First</li>
                  </ul>
                </div>
                <button
                  onClick={handleReset}
                  className="rounded-md border border-primary/35 text-primary px-4 py-2 text-sm font-medium hover:bg-primary/10 transition-colors whitespace-nowrap"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-green-600 text-white px-6 py-2 text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
          {saved && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved successfully
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
