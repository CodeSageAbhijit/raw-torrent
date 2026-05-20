import crypto from "node:crypto";
import * as bencode from "bencode";
import type { ParsedTorrentFile, StartTorrentOptions } from "../../types/torrent";
import { DEFAULT_TRACKER_URL } from "./constants";
import { asBuffer, readString, toBuffer } from "./buffers";

export const parseTorrentPayload = (
  input: StartTorrentOptions["input"],
  fileName: string
): ParsedTorrentFile => {
  const fileBuffer = toBuffer(input);

  if (fileBuffer.length === 0) {
    throw new Error("Torrent file input is empty");
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = bencode.decode(fileBuffer) as Record<string, unknown>;
  } catch (error) {
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
  const parsedFiles: { path: string; length: number }[] = [];
  const resolvedName = readString(info.name) || fileName;

  if (fileLength > 0) {
    parsedFiles.push({ path: resolvedName, length: fileLength });
  } else if (Array.isArray(info.files)) {
    for (const file of info.files) {
      if (typeof file === "object" && file !== null) {
        const length = Number((file as Record<string, unknown>).length ?? 0);
        const pathParts = Array.isArray((file as Record<string, unknown>).path)
          ? ((file as Record<string, unknown>).path as unknown[]).map(readString)
          : [];
        const filePath = pathParts.join("/");
        const fullPath = filePath ? `${resolvedName}/${filePath}` : resolvedName;
        parsedFiles.push({ path: fullPath, length });
      }
    }
  }

  const multiFileLength = parsedFiles.reduce((sum, f) => sum + f.length, 0);
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
    files: parsedFiles,
  };
};
