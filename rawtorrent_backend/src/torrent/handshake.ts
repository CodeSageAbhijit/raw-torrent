const PROTOCOL = "BitTorrent protocol";

// Reserved bytes for extension support (BEP 10)
// Byte 5, bit 4 (0x10) = Extension Protocol support
const RESERVED_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]);

const normalizeInfoHash = (infoHash: string | Buffer) => {
  if (Buffer.isBuffer(infoHash)) {
    return infoHash.subarray(0, 20);
  }

  const trimmed = infoHash.trim();

  if (/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return Buffer.from(trimmed).subarray(0, 20);
};

export const createHandshakeBuffer = (infoHash: string | Buffer, peerId: string) => {
  const protocolLength = Buffer.byteLength(PROTOCOL);
  const buffer = Buffer.alloc(49 + protocolLength);
  const infoHashBuffer = normalizeInfoHash(infoHash);
  const peerIdBuffer = Buffer.from(peerId.padEnd(20, "-").slice(0, 20));

  buffer.writeUInt8(protocolLength, 0);
  buffer.write(PROTOCOL, 1, "utf8");
  // Copy reserved bytes with extension support flag
  RESERVED_BYTES.copy(buffer, 1 + protocolLength);
  infoHashBuffer.copy(buffer, 1 + protocolLength + 8);
  peerIdBuffer.copy(buffer, 1 + protocolLength + 8 + 20);

  return buffer;
};

export const parseHandshakeBuffer = (buffer: Buffer) => {
  const protocolLength = buffer.readUInt8(0);

  if (buffer.length < 49 + protocolLength) {
    return null;
  }

  const protocol = buffer.toString("utf8", 1, 1 + protocolLength);
  const reserved = buffer.subarray(1 + protocolLength, 1 + protocolLength + 8);
  const infoHash = buffer.subarray(1 + protocolLength + 8, 1 + protocolLength + 8 + 20);
  const peerId = buffer.subarray(1 + protocolLength + 8 + 20, 1 + protocolLength + 8 + 40).toString("utf8");
  
  // Check if peer supports extensions (BEP 10)
  const supportsExtensions = (reserved[5] & 0x10) !== 0;

  return {
    protocol,
    infoHash: infoHash.toString("hex"),
    peerId,
    supportsExtensions,
    reserved,
  };
};
