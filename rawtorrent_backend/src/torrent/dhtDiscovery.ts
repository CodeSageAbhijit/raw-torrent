import type { ParsedTorrentFile, TrackerPeerDescriptor } from "../types/torrent";
import { logger } from "../utils/logger";
import { DHT_DISCOVERY_TIMEOUT_MS } from "./discovery/constants";
import { getBootstrapNodes } from "./discovery/bootstrap";
import type { DhtLike } from "./discovery/types";

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;

export const discoverPeersFromDht = async (
  torrent: ParsedTorrentFile,
  timeoutMs = DHT_DISCOVERY_TIMEOUT_MS
): Promise<TrackerPeerDescriptor[]> => {
  try {
    const dhtModule = (await dynamicImport("bittorrent-dht")) as {
      Client?: new (options?: Record<string, unknown>) => DhtLike;
      default?: new (options?: Record<string, unknown>) => DhtLike;
    };

    const DhtClient = dhtModule.Client ?? dhtModule.default;

    if (!DhtClient) {
      throw new Error("Unable to load bittorrent-dht client export");
    }

    return await new Promise<TrackerPeerDescriptor[]>((resolve) => {
      const peers = new Map<string, TrackerPeerDescriptor>();
      let settled = false;
      let lookupCount = 0;
      const maxLookups = 3; // Multiple lookups to find more peers

      const bootstrapNodes = getBootstrapNodes();

      const dht = new DhtClient({
        bootstrap: bootstrapNodes,
        // More aggressive settings for peer discovery
        maxTables: 5000,
        maxValues: 5000,
      });

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;

        try {
          dht.destroy();
        } catch {
          // Ignore cleanup errors.
        }

        resolve(Array.from(peers.values()));
      };

      const targetHash = torrent.infoHash.toLowerCase();

      dht.on("peer", (peer: unknown, infoHash: unknown) => {
        const hashHex = Buffer.isBuffer(infoHash)
          ? infoHash.toString("hex").toLowerCase()
          : typeof infoHash === "string"
            ? infoHash.toLowerCase()
            : "";

        if (hashHex !== targetHash) {
          return;
        }

        const record = typeof peer === "object" && peer !== null ? (peer as Record<string, unknown>) : null;
        if (!record) {
          return;
        }

        const host = typeof record.host === "string" ? record.host : "";
        const port = Number(record.port ?? NaN);

        if (!host || !Number.isFinite(port)) {
          return;
        }

        const key = `${host}:${port}`;
        if (!peers.has(key)) {
          peers.set(key, { ip: host, port });
        }
      });

      dht.on("error", (error: unknown) => {
        logger.warn("DHT discovery error", error);
      });

      dht.on("warning", (warning: unknown) => {
        logger.warn("DHT discovery warning", warning);
      });

      // Perform multiple lookups at intervals to discover more peers
      const doLookup = () => {
        if (settled || lookupCount >= maxLookups) return;
        lookupCount++;
        dht.lookup(Buffer.from(torrent.infoHash, "hex"));
      };

      dht.listen();
      doLookup();

      // Additional lookups every 5 seconds to find more peers
      const lookupInterval = setInterval(() => {
        if (!settled && lookupCount < maxLookups) {
          doLookup();
        }
      }, 5000);

      setTimeout(() => {
        clearInterval(lookupInterval);
        finish();
      }, timeoutMs);
    });
  } catch (error) {
    logger.warn("DHT discovery bootstrap failed", error);
    return [];
  }
};
