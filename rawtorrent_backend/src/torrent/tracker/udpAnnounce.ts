import type { ParsedTorrentFile } from "../../types/torrent";
import { logger } from "../../utils/logger";
import { parsePeerAddress } from "./peerParsing";
import type { TrackerAnnounceOptions, TrackerAnnounceResult } from "./types";

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;

export const announceToUdpTracker = async (
  trackerUrl: string,
  torrent: ParsedTorrentFile,
  options: TrackerAnnounceOptions,
  retryCount = 0
): Promise<TrackerAnnounceResult> => {
  const maxRetries = 2;

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
    const baseTimeoutMs = 15000;
    const timeoutMs = baseTimeoutMs + retryCount * 5000;
    // Use higher numwant for more peers (max 500 is typical tracker limit)
    const numwant = Math.min(options.numwant ?? 500, 500);

    return await new Promise<TrackerAnnounceResult>((resolve) => {
      const discoveredPeers = new Map<string, { ip: string; port: number }>();
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
      await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
      return announceToUdpTracker(trackerUrl, torrent, options, retryCount + 1);
    }

    return {
      interval: 1800,
      peers: [],
      trackerUrl,
    };
  }
};
