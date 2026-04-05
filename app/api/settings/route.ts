import { NextRequest, NextResponse } from "next/server";

// Proxy settings directly to backend torrent service.
// This keeps the dashboard UI and backend runtime in sync.

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

const DEFAULT_SETTINGS: Settings = {
  port: parseInt(process.env.P2P_PORT || "6881"),
  maxPeers: 120,
  downloadLimit: 12288,
  uploadLimit: 1024,
  maxRequestsPerPeer: 20,
  requestTimeoutMs: 20000,
  trackerAnnounceInterval: parseInt(process.env.TRACKER_REFRESH_SECONDS || "45"),
  trackerNumwant: parseInt(process.env.TRACKER_NUMWANT || "350"),
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: process.env.ENABLE_DHT_DISCOVERY !== "false",
  pieceSelectionStrategy: "rarest-first",
  peerConnectionTimeoutMs: parseInt(process.env.PEER_CONNECTION_TIMEOUT_MS || "12000"),
  turboMode: true,
  adaptiveTuning: true,
  extraTrackers: [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://9.rarbg.to:2710/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.publicbt.com:80/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "https://tracker.opentrackr.org:443/announce",
    "udp://tracker.1337x.com:6969/announce",
    "udp://tracker.zer0day.to:1337/announce",
  ],
};

const getBackendBaseUrl = () =>
  process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "http://localhost:4000";

const getBackendSettingsUrl = () => {
  const base = getBackendBaseUrl().replace(/\/$/, "");
  return base.endsWith("/torrent") ? `${base}/settings` : `${base}/torrent/settings`;
};

export async function GET(_request: NextRequest) {
  try {
    const response = await fetch(getBackendSettingsUrl(), {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(DEFAULT_SETTINGS, { status: 200 });
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: Settings;
    };

    return NextResponse.json(payload.data ?? DEFAULT_SETTINGS, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json(DEFAULT_SETTINGS, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate settings
    if (typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid settings format" },
        { status: 400 }
      );
    }

    const nextSettings = {
      ...DEFAULT_SETTINGS,
      ...body,
    } as Settings;

    try {
      const response = await fetch(getBackendSettingsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextSettings),
      });

      if (!response.ok) {
        const text = await response.text();
        return NextResponse.json(
          { error: `Backend settings update failed: ${text || response.statusText}` },
          { status: 502 }
        );
      }

      const payload = (await response.json()) as {
        success?: boolean;
        data?: Settings;
      };

      return NextResponse.json(
        {
          success: true,
          message: "Settings updated. New downloads will use these settings immediately.",
          updatedSettings: payload.data ?? nextSettings,
        },
        { status: 200 }
      );
    } catch (err) {
      console.error("Backend settings update failed:", err);
      return NextResponse.json(
        { error: "Failed to update backend settings" },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("Failed to save settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}

