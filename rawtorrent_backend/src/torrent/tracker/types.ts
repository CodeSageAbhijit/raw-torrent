import type { TrackerPeerDescriptor } from "../../types/torrent";

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
