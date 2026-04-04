import type { PeerMessageFrame } from "../types/peer";

export const encodeMessage = (id: number | null, payload: Buffer = Buffer.alloc(0)) => {
  const length = 1 + payload.length;

  if (id === null) {
    return Buffer.alloc(4);
  }

  const buffer = Buffer.alloc(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(id, 4);
  payload.copy(buffer, 5);

  return buffer;
};

export const decodeMessages = (buffer: Buffer) => {
  const frames: PeerMessageFrame[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);

    if (length === 0) {
      frames.push({ length, id: null, payload: Buffer.alloc(0) });
      offset += 4;
      continue;
    }

    if (offset + 4 + length > buffer.length) {
      break;
    }

    const id = buffer.readUInt8(offset + 4);
    const payload = buffer.subarray(offset + 5, offset + 4 + length);

    frames.push({ length, id, payload });
    offset += 4 + length;
  }

  return {
    messages: frames,
    remainder: buffer.subarray(offset),
  };
};

export const messageIds = {
  choke: 0,
  unchoke: 1,
  interested: 2,
  notInterested: 3,
  have: 4,
  bitfield: 5,
  request: 6,
  piece: 7,
  cancel: 8,
} as const;
