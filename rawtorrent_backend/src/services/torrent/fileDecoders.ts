import bencode from "bencode";
import { logger } from "../../utils/logger";
import type { TorrentFileInfo } from "../../types/torrent";

export const decodeTorrentFiles = (buffer: Buffer): TorrentFileInfo[] => {
  try {
    const decoded = bencode.decode(buffer) as any;
    const info = decoded.info;
    if (!info) throw new Error("No info dictionary found in torrent file");

    if (!info.files) {
      const length = Number(info.length || 0);
      const nameList = Array.isArray(info.name)
        ? info.name.map((b: Buffer) => b.toString("utf8"))
        : [info.name ? info.name.toString("utf8") : "download.bin"];

      const fileName = nameList[0] || "download.bin";
      return [
        {
          index: 0,
          name: fileName,
          path: fileName,
          length,
          selected: true,
        },
      ];
    }

    const files = info.files;
    const baseName = info.name ? info.name.toString("utf8") : "download";

    return files.map((fileObj: any, idx: number) => {
      let pathSegments: string[] = [];
      if (Array.isArray(fileObj.path)) {
        pathSegments = fileObj.path.map((b: Buffer) => b.toString("utf8"));
      }

      const filePath = [baseName, ...pathSegments].join("/");
      const fileName = pathSegments[pathSegments.length - 1] || `${baseName}-file-${idx}`;

      return {
        index: idx,
        name: fileName,
        path: filePath,
        length: Number(fileObj.length || 0),
        selected: true,
      };
    });
  } catch (error) {
    logger.error("[decodeTorrentFiles] Error decoding torrent file:", error);
    throw error;
  }
};
