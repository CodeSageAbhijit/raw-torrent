import type { ParsedTorrentFile } from "../types/torrent";
import { logger } from "../utils/logger";
import { announceToHttpTracker } from "./tracker/httpAnnounce";
import { announceToUdpTracker } from "./tracker/udpAnnounce";
import type { TrackerAnnounceOptions, TrackerAnnounceResult } from "./tracker/types";

export type { TrackerAnnounceOptions, TrackerAnnounceResult } from "./tracker/types";

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

  return announceToHttpTracker(trackerUrl, torrent, options);
};
