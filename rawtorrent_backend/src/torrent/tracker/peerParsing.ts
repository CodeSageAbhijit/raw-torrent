import type { TrackerPeerDescriptor } from "../../types/torrent";

export const parsePeerAddress = (address: string): TrackerPeerDescriptor | null => {
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

export const normalizePeers = (value: unknown): TrackerPeerDescriptor[] => {
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

export const normalizePeersV6 = (value: unknown): TrackerPeerDescriptor[] => {
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

export const percentEncodeBytes = (buffer: Buffer) =>
  Array.from(buffer)
    .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
    .join("");
