import type { StartTorrentOptions } from "../../types/torrent";

export const toBuffer = (input: StartTorrentOptions["input"]) => {
  if (!input) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }

  if (input instanceof Uint8Array) {
    return Buffer.from(input);
  }

  return Buffer.from(input);
};

export const asBuffer = (value: unknown) => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
};

export const readString = (value: unknown) => asBuffer(value).toString("utf8");
