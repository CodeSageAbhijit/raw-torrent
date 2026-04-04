export type SessionStatus = "active" | "paused" | "queued";

export type TorrentSession = {
  id: string;
  name: string;
  status: SessionStatus;
  progress: number;
  peers: number;
  seeders: number;
  leechers: number;
  trackers: number;
  downSpeedMbps: number;
  upSpeedMbps: number;
  sizeGb: number;
  encryption: string;
};

export type PeerInfo = {
  id: string;
  ip: string;
  client: string;
  pieces: number;
  contribution: number;
  downloadMbps: number;
  uploadMbps: number;
  encryption: string;
  coordinates: [number, number]; // [longitude, latitude]
};

export const sessions: TorrentSession[] = [
  {
    id: "alpha-923",
    name: "ubuntu-24.04-desktop-amd64.iso",
    status: "active",
    progress: 64,
    peers: 38,
    seeders: 12,
    leechers: 26,
    trackers: 3,
    downSpeedMbps: 14.2,
    upSpeedMbps: 2.1,
    sizeGb: 5.7,
    encryption: "RC4-SHA",
  },
  {
    id: "raw-849",
    name: "public-dataset-archive.tar",
    status: "paused",
    progress: 22,
    peers: 17,
    seeders: 4,
    leechers: 13,
    trackers: 1,
    downSpeedMbps: 0,
    upSpeedMbps: 0,
    sizeGb: 12.4,
    encryption: "Plaintext",
  },
  {
    id: "stream-611",
    name: "foss-footage-pack-4k.zip",
    status: "queued",
    progress: 3,
    peers: 8,
    seeders: 1,
    leechers: 7,
    trackers: 2,
    downSpeedMbps: 0.8,
    upSpeedMbps: 0.2,
    sizeGb: 31.8,
    encryption: "MSE/PE",
  },
];

export const peerSnapshots: PeerInfo[] = [
  {
    id: "peer-12f",
    ip: "45.22.119.10",
    client: "qBittorrent/5.0",
    pieces: 142,
    contribution: 22,
    downloadMbps: 3.2,
    uploadMbps: 0.6,
    encryption: "MSE/PE",
    coordinates: [-122.4194, 37.7749], // San Francisco
  },
  {
    id: "peer-98a",
    ip: "189.67.22.9",
    client: "Transmission/4.1",
    pieces: 120,
    contribution: 18,
    downloadMbps: 2.6,
    uploadMbps: 0.4,
    encryption: "Plaintext",
    coordinates: [-43.1729, -22.9068], // Rio de Janeiro
  },
  {
    id: "peer-7dc",
    ip: "91.14.202.73",
    client: "libtorrent/2.0",
    pieces: 166,
    contribution: 27,
    downloadMbps: 4.4,
    uploadMbps: 1.1,
    encryption: "RC4",
    coordinates: [13.405, 52.52], // Berlin
  },
  {
    id: "peer-41b",
    ip: "27.180.55.220",
    client: "Deluge/2.1",
    pieces: 78,
    contribution: 11,
    downloadMbps: 1.7,
    uploadMbps: 0.3,
    encryption: "MSE/PE",
    coordinates: [139.6917, 35.6895], // Tokyo
  },
  {
    id: "peer-22x",
    ip: "105.112.55.22",
    client: "uTorrent/3.5",
    pieces: 42,
    contribution: 5,
    downloadMbps: 1.1,
    uploadMbps: 0.1,
    encryption: "MSE/PE",
    coordinates: [18.4232, -33.9249], // Cape Town
  },
];

export const initialLogs = [
  "[announce] tracker response: interval=1800 peers=38",
  "[wire] handshake completed with peer-12f",
  "[wire] bitfield received from peer-7dc",
  "[piece] requested index=472 from peer-98a",
  "[piece] verified sha1 index=471",
  "[choke] peer-41b unchoked local client",
  "[have] peer-12f reported piece=480",
];

export function formatSpeed(value: number) {
  return `${value.toFixed(1)} MB/s`;
}
