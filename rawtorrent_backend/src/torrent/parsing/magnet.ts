import type { ParsedTorrentFile } from "../../types/torrent";
import { DEFAULT_TRACKER_URL } from "./constants";
import { decodeBase32 } from "./base32";

export const parseMagnetUri = (magnetUri: string, fileName?: string): ParsedTorrentFile => {
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
    files: [],
  };
};
