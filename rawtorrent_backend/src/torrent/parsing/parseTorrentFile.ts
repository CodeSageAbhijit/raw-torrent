import type { ParsedTorrentFile, StartTorrentOptions } from "../../types/torrent";
import { parseMagnetUri } from "./magnet";
import { parseTorrentPayload } from "./torrentFile";

export const parseTorrentFile = async (
  input: StartTorrentOptions["input"],
  fileName = "rawtorrent-session",
  magnetUri?: string
): Promise<ParsedTorrentFile> => {
  if (magnetUri?.startsWith("magnet:?")) {
    return parseMagnetUri(magnetUri, fileName);
  }

  return parseTorrentPayload(input, fileName);
};
