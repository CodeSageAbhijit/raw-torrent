import crypto from "node:crypto";

export const assemblePieceData = (blocks: Map<number, Buffer>): Buffer => {
  const sortedOffsets = Array.from(blocks.keys()).sort((a, b) => a - b);
  const buffers: Buffer[] = [];

  for (const offset of sortedOffsets) {
    const block = blocks.get(offset);
    if (block) {
      buffers.push(block);
    }
  }

  return Buffer.concat(buffers);
};

export const verifyPieceHash = (pieceData: Buffer, expectedHash: string): boolean => {
  const hash = crypto.createHash("sha1").update(pieceData).digest("hex");
  return hash === expectedHash;
};
