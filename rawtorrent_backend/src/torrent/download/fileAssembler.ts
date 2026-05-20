import fs from "node:fs";
import { piecePath, type SessionStoragePaths } from "../../services/fileStorageService";

export const assembleFileOnDisk = (
  storage: SessionStoragePaths,
  pieceCount: number
): { path: string; size: number } => {
  const fileDescriptor = fs.openSync(storage.finalFilePath, "w");

  try {
    let offset = 0;

    for (let index = 0; index < pieceCount; index += 1) {
      const currentPiecePath = piecePath(storage, index);

      if (!fs.existsSync(currentPiecePath)) {
        throw new Error(`Missing piece file ${index} during final assembly`);
      }

      const chunk = fs.readFileSync(currentPiecePath);
      fs.writeSync(fileDescriptor, chunk, 0, chunk.length, offset);
      offset += chunk.length;
    }

    return {
      path: storage.finalFilePath,
      size: offset,
    };
  } finally {
    fs.closeSync(fileDescriptor);
  }
};
