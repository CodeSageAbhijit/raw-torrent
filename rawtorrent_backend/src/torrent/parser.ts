import crypto from "node:crypto";
import * as bencode from "bencode";
import type { ParsedTorrentFile, StartTorrentOptions } from "../types/torrent"; 

const DEFAULT_TRACKER_URL =
  process.env.TORRENT_TRACKER_URL ?? "https://tracker.opentrackr.org:443/announce";

const toBuffer = (input: StartTorrentOptions["input"]) => {
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

const decodeBase32 = (value: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 info hash");
    }

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let cursor = 0; cursor + 8 <= bits.length; cursor += 8) {
    bytes.push(Number.parseInt(bits.slice(cursor, cursor + 8), 2));
  }

  return Buffer.from(bytes);
};

const parseMagnetUri = (magnetUri: string, fileName?: string): ParsedTorrentFile => {
  const url = new URL(magnetUri);
  const xt = url.searchParams.get("xt") ?? "";
  const dn = url.searchParams.get("dn") ?? fileName ?? "magnet-session";
  const tr = url.searchParams.getAll("tr");
  const hashPart = xt.startsWith("urn:btih:") ? xt.slice("urn:btih:".length) : "";

  if (!hashPart) {
    throw new Error("Magnet URI is missing urn:btih hash");
  }

  let infoHashBuffer: Buffer;

  if (/^[a-fA-F0-9]{40}$/.test(hashPart)) {
    infoHashBuffer = Buffer.from(hashPart, "hex");
  } else {
    infoHashBuffer = decodeBase32(hashPart);
  }

  const announceList = tr.length > 0 ? tr : [DEFAULT_TRACKER_URL];

  return {
    fileName: dn,
    sourceType: "magnet",
    trackerUrl: announceList[0],
    trackerUrls: announceList,
    infoHash: infoHashBuffer.toString("hex"),
    pieceLength: 0,
    pieceHashes: [],
    totalLength: 0,
    announceList,
  };
};

const asBuffer = (value: unknown) => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
};

const readString = (value: unknown) => asBuffer(value).toString("utf8");

export const parseTorrentFile = async (
  input: StartTorrentOptions["input"],
  fileName = "rawtorrent-session",
  magnetUri?: string
): Promise<ParsedTorrentFile> => {
  if (magnetUri?.startsWith("magnet:?")) {
    return parseMagnetUri(magnetUri, fileName);
  }

  const fileBuffer = toBuffer(input);

  console.log("[parser] fileBuffer length:", fileBuffer?.length);

  if (fileBuffer.length === 0) {
    throw new Error("Torrent file input is empty");
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = bencode.decode(fileBuffer) as Record<string, unknown>;
    console.log("[parser] decoded keys:", Object.keys(decoded));
  } catch (error) {
    console.error("[parser] bencode.decode error:", error);
    throw new Error("Failed to decode torrent file");
  }

  const info = decoded.info as Record<string, unknown> | undefined;

  if (!info) {
    throw new Error("Invalid torrent file: missing info dictionary");
  }

  const encodedInfo = bencode.encode(info);
  const infoHash = crypto.createHash("sha1").update(encodedInfo).digest("hex");
  const piecesBuffer = asBuffer(info.pieces);
  const pieceHashes: string[] = [];

  for (let offset = 0; offset + 20 <= piecesBuffer.length; offset += 20) {
    pieceHashes.push(piecesBuffer.subarray(offset, offset + 20).toString("hex"));
  }

  const pieceLength = Number(info["piece length"] ?? 0);
  const fileLength = Number(info.length ?? 0);
  const multiFileLength = Array.isArray(info.files)
    ? info.files.reduce((sum, file) => {
        if (typeof file === "object" && file !== null && "length" in file) {
          return sum + Number((file as Record<string, unknown>).length ?? 0);
        }

        return sum;
      }, 0)
    : 0;
  const totalLength = fileLength > 0 ? fileLength : multiFileLength;

  const announce = readString(decoded.announce);
  const announceList = Array.isArray(decoded["announce-list"])
    ? (decoded["announce-list"] as unknown[])
        .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
        .map(readString)
        .filter(Boolean)
    : [];

  const trackerUrls = [announce, ...announceList].filter(Boolean);
  const resolvedTrackers = trackerUrls.length > 0 ? trackerUrls : [DEFAULT_TRACKER_URL];

  const resolvedName = readString(info.name) || fileName;

  return {
    fileName: resolvedName,
    sourceType: "torrent-file",
    trackerUrl: resolvedTrackers[0],
    trackerUrls: resolvedTrackers,
    infoHash,
    pieceLength,
    pieceHashes,
    totalLength,
    announceList: resolvedTrackers,
  };
};
