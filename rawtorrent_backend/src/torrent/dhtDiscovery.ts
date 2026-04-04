import type { ParsedTorrentFile, TrackerPeerDescriptor } from "../types/torrent";
import { logger } from "../utils/logger";

type DynamicImport = (specifier: string) => Promise<unknown>;
const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;

interface DhtLike {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  listen: (port?: number) => void;
  lookup: (infoHash: string | Buffer) => void;
  destroy: () => void;
}

// Default bootstrap nodes for DHT - these are well-known public DHT nodes
const DEFAULT_BOOTSTRAP_NODES = [
  "router.bittorrent.com:6881",
  "dht.transmissionbt.com:6881",
  "router.utorrent.com:6881",
  "dht.aelitis.com:6881",
  "router.silotis.us:6881",
];

const parseBootstrapNodes = (): string[] => {
  const raw = process.env.DHT_BOOTSTRAP_NODES;

  if (!raw) {
    return DEFAULT_BOOTSTRAP_NODES;
  }

  const nodes = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return nodes.length > 0 ? [...nodes, ...DEFAULT_BOOTSTRAP_NODES] : DEFAULT_BOOTSTRAP_NODES;
};

export const discoverPeersFromDht = async (
  torrent: ParsedTorrentFile,
  timeoutMs = Number(process.env.DHT_DISCOVERY_TIMEOUT_MS ?? 15000)
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

      const bootstrapNodes = parseBootstrapNodes();
      console.log(`[DHT] Using ${bootstrapNodes.length} bootstrap nodes`);

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
          // Log periodically
          if (peers.size % 50 === 0) {
            console.log(`[DHT] Discovered ${peers.size} peers so far...`);
          }
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
        console.log(`[DHT] Starting lookup #${lookupCount}...`);
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
        console.log(`[DHT] Discovery completed. Total peers found: ${peers.size}`);
        finish();
      }, timeoutMs);
    });
  } catch (error) {
    logger.warn("DHT discovery bootstrap failed", error);
    return [];
  }
};
