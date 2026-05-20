import type { ParsedTorrentFile } from "../../types/torrent";
import { logger } from "../../utils/logger";
import { decodeBencodedTrackerResponse } from "./decoder";
import { normalizePeers, normalizePeersV6, percentEncodeBytes } from "./peerParsing";
import type { TrackerAnnounceOptions, TrackerAnnounceResult } from "./types";

export const announceToHttpTracker = async (
  trackerUrl: string,
  torrent: ParsedTorrentFile,
  options: TrackerAnnounceOptions
): Promise<TrackerAnnounceResult> => {
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
    const response = await fetch(announceUrl, {
      headers: {
        "user-agent": "RawTorrentBackend/0.1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Tracker response failed with status ${response.status}`);
    }

    const body = await decodeBencodedTrackerResponse(response);

    if (body["failure reason"]) {
      const reason = Buffer.isBuffer(body["failure reason"]) ? body["failure reason"].toString("utf8") : body["failure reason"];
      logger.warn("Tracker failure", reason);
      return {
        interval: 1800,
        peers: [],
        trackerUrl,
      };
    }

    const peers = normalizePeers(body.peers);
    const peers6 = normalizePeersV6(body.peers6);

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
