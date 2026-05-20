import type { TrackerPeerDescriptor } from "../../types/torrent";

type TorrentLike = any;

type PeerAddress = { ip: string; port: number };

type CollectionLike = Map<unknown, unknown> | Set<unknown> | unknown[] | Record<string, unknown> | null | undefined;

export const parsePeerAddress = (address: string | undefined): PeerAddress => {
  if (!address) {
    return { ip: "unknown", port: 0 };
  }

  const lastColon = address.lastIndexOf(":");
  if (lastColon === -1) {
    return { ip: address, port: 0 };
  }

  const ip = address.slice(0, lastColon);
  const port = Number(address.slice(lastColon + 1)) || 0;
  return { ip, port };
};

export const getPeerLabel = (wire: any, address: PeerAddress) => {
  const peerId = String(wire?.peerId ?? "").trim();
  if (peerId) {
    return `peer-${peerId.slice(-3)}`;
  }

  if (address.ip !== "unknown") {
    const compactIp = address.ip.split(".").slice(-2).join("-");
    return `peer-${compactIp}`;
  }

  return "peer-unk";
};

export const inferPeerEncryption = (wire: any): "unknown" | "plaintext" | "mse-rc4" => {
  const encryptedFlags = [
    wire?.encrypted,
    wire?.isEncrypted,
    wire?._encrypted,
    wire?.peerEncrypted,
    wire?._pe1,
    wire?.cryptoHandshakeDone,
    wire?._cryptoHandshakeDone,
  ];

  if (encryptedFlags.some((value) => value === true)) {
    return "mse-rc4";
  }

  const explicitTransportEncryption = wire?.conn?.encrypted;
  if (typeof explicitTransportEncryption === "boolean") {
    return explicitTransportEncryption ? "mse-rc4" : "plaintext";
  }

  const explicitFalseFlags = [wire?.encrypted, wire?.isEncrypted, wire?._encrypted, wire?.peerEncrypted];
  if (explicitFalseFlags.some((value) => value === false)) {
    return "plaintext";
  }

  return "unknown";
};

const collectionSize = (value: CollectionLike): number => {
  if (value instanceof Map || value instanceof Set) {
    return value.size;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }

  return 0;
};

export const estimateDiscoveredPeers = (torrent: TorrentLike, activePeers: number): number => {
  const discovery = torrent?.discovery ?? torrent?._discovery;
  const counts = [
    activePeers,
    Number(torrent?.numPeers ?? 0),
    Number(torrent?._numPeers ?? 0),
    collectionSize(torrent?._peers),
    collectionSize(discovery?._peers),
    collectionSize(discovery?.tracker?._peers),
    collectionSize(discovery?.tracker?.client?._peers),
  ].filter((value) => Number.isFinite(value) && value >= 0) as number[];

  if (counts.length === 0) {
    return activePeers;
  }

  return Math.max(...counts);
};

export const getPeersFromTorrent = (torrent: TorrentLike): TrackerPeerDescriptor[] => {
  const wireList: any[] = Array.isArray(torrent?.wires) ? torrent.wires : [];
  const seen = new Set<string>();
  const peers: TrackerPeerDescriptor[] = [];

  for (const wire of wireList) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    if (seen.has(`${address.ip}:${resolvedPort}`) || resolvedPort <= 0) {
      continue;
    }

    seen.add(`${address.ip}:${resolvedPort}`);
    peers.push({ ip: address.ip, port: resolvedPort, peerId: wire?.peerId });
  }

  return peers;
};
