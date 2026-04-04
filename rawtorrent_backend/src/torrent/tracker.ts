import * as bencode from "bencode";
import type { ParsedTorrentFile, TrackerPeerDescriptor } from "../types/torrent";
import { logger } from "../utils/logger";

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;

export interface TrackerAnnounceOptions {
  peerId: string;
  port: number;
  uploaded?: number;
  downloaded?: number;
  left?: number;
  numwant?: number;
  event?: "started" | "stopped" | "completed" | "paused";
}

export interface TrackerAnnounceResult {
  interval: number;
  peers: TrackerPeerDescriptor[];
  trackerUrl: string;
}

const parsePeerAddress = (address: string): TrackerPeerDescriptor | null => {
  if (!address) {
    return null;
  }

  const trimmed = address.trim();

  // IPv6 style: [2001:db8::1]:6881
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end <= 0) {
      return null;
    }

    const host = trimmed.slice(1, end);
    const portText = trimmed.slice(end + 2);
    const port = Number(portText);

    if (!host || !Number.isFinite(port)) {
      return null;
    }

    return { ip: host, port };
  }

  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0) {
    return null;
  }

  const host = trimmed.slice(0, separator);
  const portText = trimmed.slice(separator + 1);
  const port = Number(portText);

  if (!host || !Number.isFinite(port)) {
    return null;
  }

  return { ip: host, port };
};

const announceToUdpTracker = async (
  trackerUrl: string,
  torrent: ParsedTorrentFile,
  options: TrackerAnnounceOptions,
  retryCount = 0
): Promise<TrackerAnnounceResult> => {
  const maxRetries = Number(process.env.UDP_TRACKER_MAX_RETRIES ?? 2);
  
  try {
    const trackerModule = (await dynamicImport("bittorrent-tracker")) as {
      Client?: new (options: Record<string, unknown>) => {
        on: (event: string, listener: (...args: unknown[]) => void) => void;
        start: () => void;
        destroy: () => void;
      };
      default?: {
        Client?: new (options: Record<string, unknown>) => {
          on: (event: string, listener: (...args: unknown[]) => void) => void;
          start: () => void;
          destroy: () => void;
        };
      };
    };

    const TrackerClient = trackerModule.Client ?? trackerModule.default?.Client;

    if (!TrackerClient) {
      throw new Error("Unable to load bittorrent-tracker Client export");
    }

    // Increase timeout: 15s base + 5s per retry for better reliability
    const baseTimeoutMs = Number(process.env.UDP_TRACKER_TIMEOUT_MS ?? 15000);
    const timeoutMs = baseTimeoutMs + (retryCount * 5000);
    // Use higher numwant for more peers (max 500 is typical tracker limit)
    const numwant = Math.min(options.numwant ?? 500, 500);

    return await new Promise<TrackerAnnounceResult>((resolve) => {
      const discoveredPeers = new Map<string, TrackerPeerDescriptor>();
      let interval = 1800;
      let settled = false;

      const client = new TrackerClient({
        infoHash: Buffer.from(torrent.infoHash, "hex"),
        peerId: Buffer.from(options.peerId.padEnd(20, "-").slice(0, 20), "utf8"),
        announce: [trackerUrl],
        port: options.port,
        uploaded: options.uploaded ?? 0,
        downloaded: options.downloaded ?? 0,
        left: options.left ?? torrent.totalLength,
        numwant,
      });

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;

        try {
          client.destroy();
        } catch {
          // Ignore cleanup errors.
        }

        resolve({
          interval,
          peers: Array.from(discoveredPeers.values()),
          trackerUrl,
        });
      };

      const timer = setTimeout(() => {
        console.log(`[Tracker][UDP] Timeout for ${trackerUrl} after ${timeoutMs}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
        finish();
      }, timeoutMs);

      client.on("update", (data: unknown) => {
        const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
        if (record && Number.isFinite(Number(record.interval))) {
          interval = Number(record.interval);
        }
      });

      client.on("peer", (address: unknown) => {
        if (typeof address !== "string") {
          return;
        }

        const peer = parsePeerAddress(address);
        if (!peer) {
          return;
        }

        discoveredPeers.set(`${peer.ip}:${peer.port}`, peer);
      });

      client.on("error", (error: unknown) => {
        logger.warn(`UDP tracker error for ${trackerUrl}`, error);
        clearTimeout(timer);
        finish();
      });

      client.on("warning", (warning: unknown) => {
        logger.warn(`UDP tracker warning for ${trackerUrl}`, warning);
      });

      client.start();
    });
  } catch (error) {
    logger.warn(`UDP tracker announce failed for ${trackerUrl} (attempt ${retryCount + 1})`, error);
    
    // Retry logic for transient failures
    if (retryCount < maxRetries) {
      console.log(`[Tracker][UDP] Retrying ${trackerUrl} (attempt ${retryCount + 2}/${maxRetries + 1})...`);
      await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1))); // Exponential backoff
      return announceToUdpTracker(trackerUrl, torrent, options, retryCount + 1);
    }
    
    return {
      interval: 1800,
      peers: [],
      trackerUrl,
    };
  }
};

const normalizePeers = (value: unknown): TrackerPeerDescriptor[] => {
  console.log(`[Tracker] normalizePeers received value of type: `, typeof value, 'Is Buffer:', Buffer.isBuffer(value), 'Is Array:', Array.isArray(value), 'Length if Array/Buffer:', (value as any)?.length);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const peers: TrackerPeerDescriptor[] = [];
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);

    for (let offset = 0; offset + 6 <= buf.length; offset += 6) {
      const ip = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
      const port = buf.readUInt16BE(offset + 4);
      peers.push({ ip, port });
    }

    return peers;
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const peers: TrackerPeerDescriptor[] = [];

  for (const peer of value) {
    if (typeof peer !== "object" || peer === null) {
      continue;
    }

    const record = peer as Record<string, unknown>;
    const ip = Buffer.isBuffer(record.ip)
      ? record.ip.toString("utf8")
      : typeof record.ip === "string"
        ? record.ip
        : Buffer.isBuffer(record.host)
          ? record.host.toString("utf8")
          : typeof record.host === "string"
            ? record.host
            : "127.0.0.1";
    const port = typeof record.port === "number" ? record.port : Number(record.port ?? 6881);

    peers.push({
      ip,
      port,
      peerId: typeof record.peerId === "string" ? record.peerId : undefined,
    });
  }

  return peers;
};

const normalizePeersV6 = (value: unknown): TrackerPeerDescriptor[] => {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return [];
  }

  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const peers: TrackerPeerDescriptor[] = [];

  for (let offset = 0; offset + 18 <= buf.length; offset += 18) {
    const addressBytes = buf.subarray(offset, offset + 16);
    const segments: string[] = [];

    for (let index = 0; index < 16; index += 2) {
      segments.push(addressBytes.readUInt16BE(index).toString(16));
    }

    const ip = segments.join(":");
    const port = buf.readUInt16BE(offset + 16);
    peers.push({ ip, port });
  }

  return peers;
};

const percentEncodeBytes = (buffer: Buffer) =>
  Array.from(buffer)
    .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
    .join("");

const decodeBencodedTrackerResponse = async (response: Response) => {
  const bytes = Buffer.from(await response.arrayBuffer());
  return bencode.decode(bytes) as Record<string, unknown>;
};

export const announceToTracker = async (
  torrent: ParsedTorrentFile,
  options: TrackerAnnounceOptions
): Promise<TrackerAnnounceResult> => {
  const trackerUrl = torrent.trackerUrl;

  if (trackerUrl.startsWith("udp://")) {
    return announceToUdpTracker(trackerUrl, torrent, options);
  }

  if (!trackerUrl.startsWith("http://") && !trackerUrl.startsWith("https://")) {
    logger.warn(`Tracker URL ${trackerUrl} is not HTTP based. Returning an empty peer list for now.`);
    return {
      interval: 1800,
      peers: [],
      trackerUrl,
    };
  }

  const infoHashBytes = Buffer.from(torrent.infoHash, "hex");
  const peerIdBytes = Buffer.from(options.peerId.padEnd(20, "-").slice(0, 20), "utf8");

  // Use higher numwant for more peers (max 500 is typical tracker limit)
  const numwant = Math.min(options.numwant ?? 500, 500);
  
  const params = [
    `info_hash=${percentEncodeBytes(infoHashBytes)}`,
    `peer_id=${percentEncodeBytes(peerIdBytes)}`,
    `port=${encodeURIComponent(String(options.port))}`,
    `uploaded=${encodeURIComponent(String(options.uploaded ?? 0))}`,
    `downloaded=${encodeURIComponent(String(options.downloaded ?? 0))}`,
    `left=${encodeURIComponent(String(options.left ?? torrent.totalLength))}`,
    `numwant=${encodeURIComponent(String(numwant))}`,
    "compact=1",
    "no_peer_id=1",
  ];
  if (options.event) {
    params.push(`event=${encodeURIComponent(options.event)}`);
  }

  const separator = trackerUrl.includes("?") ? "&" : "?";
  const announceUrl = `${trackerUrl}${separator}${params.join("&")}`;

  try {
    console.log(`[Tracker] Fetching: ${announceUrl}`);
    const response = await fetch(announceUrl, {
      headers: {
        "user-agent": "RawTorrentBackend/0.1.0",
      },
    });

    if (!response.ok) {
      console.error(`[Tracker] Response failed: ${response.status} ${response.statusText}`);
      throw new Error(`Tracker response failed with status ${response.status}`);
    }

    const body = await decodeBencodedTrackerResponse(response);
    console.log("[Tracker] Decoded body keys:", Object.keys(body));

    if (body["failure reason"]) {
      const reason = Buffer.isBuffer(body["failure reason"]) ? body["failure reason"].toString("utf8") : body["failure reason"];
      console.error("[Tracker] Failure reason:", reason);
      logger.warn("Tracker failure", reason);
      return {
        interval: 1800,
        peers: [],
        trackerUrl,
      };
    }

    const peers = normalizePeers(body.peers);
    const peers6 = normalizePeersV6(body.peers6);

    if (peers6.length > 0) {
      console.log(`[Tracker] Parsed IPv6 peers: ${peers6.length}`);
    }

    return {
      interval: Number(body.interval ?? 1800),
      peers: [...peers, ...peers6],
      trackerUrl,
    };

  } catch (error) {
    logger.warn("Tracker announce failed", error);

    return {
      interval: 1800,
      peers: [],
      trackerUrl,
    };
  }
};
