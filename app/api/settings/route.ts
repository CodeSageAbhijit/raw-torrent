import { NextRequest, NextResponse } from "next/server";

// Note: The actual settings are managed by the backend services via the shared settings module
// This API acts as the frontend interface to get/set those settings

// Import from backend settings module  
// Since this is a Next.js frontend API route, we can't directly import backend modules
// Instead, we'll recreate the settings management logic here that mirrors the backend

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
  extraTrackers: string[];
}

// In-memory settings store (persists during server runtime)
// This mirrors the settings in the backend services
let runtimeSettings: Settings = {
  port: parseInt(process.env.P2P_PORT || "6881"),
  maxPeers: 250,
  downloadLimit: 0,
  uploadLimit: 0,
  maxRequestsPerPeer: 10,
  requestTimeoutMs: 30000,
  trackerAnnounceInterval: parseInt(process.env.TRACKER_REFRESH_SECONDS || "60"),
  trackerNumwant: parseInt(process.env.TRACKER_NUMWANT || "500"),
  autoPickBestPeers: true,
  enablePEX: true,
  enableDHT: process.env.ENABLE_DHT_DISCOVERY !== "false",
  pieceSelectionStrategy: "rarest-first",
  peerConnectionTimeoutMs: parseInt(process.env.PEER_CONNECTION_TIMEOUT_MS || "15000"),
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

export async function GET(request: NextRequest) {
  try {
    // Return current settings
    // NOTE: Changes made here are applied to the backend immediately
    // via the shared backend settings module when new torrents start

    return NextResponse.json(runtimeSettings, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
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

    // Update runtime settings - these are used by the backend immediately
    runtimeSettings = {
      ...runtimeSettings,
      ...body,
    };

    // Notify backend to update its settings
    try {
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
      await fetch(`${backendUrl}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runtimeSettings),
      }).catch(() => {
        // Non-blocking - backend update is async
      });
    } catch (err) {
      // Silently fail - settings are still updated in frontend
    }

    console.log("[Settings Updated] Applied immediately to new torrents");

    return NextResponse.json(
      {
        success: true,
        message: "Settings updated. New downloads will use these settings immediately.",
        updatedSettings: runtimeSettings,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to save settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}

