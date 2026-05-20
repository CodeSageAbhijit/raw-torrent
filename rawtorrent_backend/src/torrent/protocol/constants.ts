export const PROTOCOL_NAME = "BitTorrent protocol";

// Reserved bytes for extension support (BEP 10)
// Byte 5, bit 4 (0x10) = Extension Protocol support
export const RESERVED_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00]);
