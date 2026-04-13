import fs from "node:fs";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { ensureSessionStorage, getSessionStoragePaths } from "./fileStorageService";

export interface StoreOptions {
  length: number;
  files?: { path: string; length: number; offset: number }[];
  name?: string;
  savePath?: string;
}

export class PieceFileStore {
  chunkLength: number;
  length: number;
  files: StoreOptions["files"];
  piecesDir: string;
  sessionId: string;
  private writeQueue: Promise<void> = Promise.resolve(); // Simple write queue to stop 100% active time
  
  constructor(chunkLength: number, opts: StoreOptions, sessionId: string) {
    this.chunkLength = chunkLength;
    this.length = opts.length;
    this.files = opts.files || [];
    this.sessionId = sessionId;
    
    const paths = getSessionStoragePaths(sessionId, opts.name || "download.bin", opts.savePath);
    ensureSessionStorage(paths);
    this.piecesDir = paths.piecesDir;
  }

  getPiecePath(index: number) {
    return path.join(this.piecesDir, `piece_${index}.bin`);
  }

  put(index: number, buf: Buffer, cb: (err: NodeJS.ErrnoException | null) => void) {
    const piecePath = this.getPiecePath(index);
    
    // Serialize all disk writes. This strictly caps NVMe active time.
    // Instead of blasting 200 concurrent fs.writeFile events randomly
    // across the SSD when WebTorrent pauses, we feed them exactly 1-by-1.
    this.writeQueue = this.writeQueue.then(() => {
      return new Promise<void>((resolve) => {
        fs.writeFile(piecePath, buf, (err) => {
          cb(err);
          resolve(); 
        });
      });
    }).catch(() => {
      // Allow queue to continue even if a single piece fails
      cb(new Error("Previous piece write failed"));
    });
  }

  get(index: number, opts: { offset?: number; length?: number }, cb: (err: Error | null, buf?: Buffer) => void) {
    const piecePath = this.getPiecePath(index);
    const cbOpts = typeof opts === "function" ? opts : null;
    const callback = cbOpts || cb;
    const options = typeof opts === "object" ? opts : {};
    const offset = options.offset || 0;
    const length = options.length || (this.chunkLength - offset);

    if (fs.existsSync(piecePath)) {
      const chunks: Buffer[] = [];
      const rs = fs.createReadStream(piecePath, { start: offset, end: offset + length - 1 });
      rs.on("error", (err) => callback(err));
      rs.on("data", (chunk: any) => chunks.push(Buffer.from(chunk)));
      rs.on("end", () => callback(null, Buffer.concat(chunks)));
    } else {
      callback(new Error(`Piece ${index} not found on disk`));
    }
  }

  close(cb: (err: Error | null) => void) {
    if (cb) cb(null);
  }

  destroy(cb: (err: Error | null) => void) {
    if (cb) cb(null);
  }
}

const stores = new Map<string, PieceFileStore>();

export const createPieceStore = (sessionId: string, savePath?: string) => {
  return class SessionPieceFileStore extends PieceFileStore {
    constructor(chunkLength: number, opts: StoreOptions) {
      if (savePath) {
        opts.savePath = savePath;
      }
      super(chunkLength, opts, sessionId);
      stores.set(sessionId, this);
    }
  } as any;
};


export const getPieceStoreForSession = (sessionId: string): PieceFileStore | undefined => {
  return stores.get(sessionId);
};

export const stitchPieceFiles = async (sessionId: string, sessionDir: string, filesOverrides?: any[]) => {
  const store = stores.get(sessionId);
  if (!store) {
    return;
  }

  const pieceLength = store.chunkLength;
  const files = (filesOverrides || store.files) || [];
  
  if (files.length === 0) return;

  for (const f of files) {
    const fullPath = path.join(sessionDir, f.path);
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
  }

  let currentFileIndex = 0;
  let currentFile = files[currentFileIndex];
  
  if (!currentFile) return;

  let currentFd = await fsPromises.open(path.join(sessionDir, currentFile.path), "w");
  let currentFileBytesWritten = 0;
  
  const totalLength = files.reduce((acc, f) => Math.max(acc, f.offset + f.length), 0);
  const numPieces = Math.ceil(totalLength / pieceLength);

  try {
    for (let i = 0; i < numPieces; i++) {
      const piecePath = store.getPiecePath(i);
      
      const exists = await fsPromises.stat(piecePath).catch(() => null);
      if (!exists) {
        continue; // Assume it was zero-padded in WebTorrent, or handled.
      }
      
      const pieceBuffer = await fsPromises.readFile(piecePath);
      let piecePos = 0;

      while (piecePos < pieceBuffer.length) {
        if (currentFileBytesWritten >= currentFile.length) {
          await currentFd.close();
          currentFileIndex++;
          if (currentFileIndex >= files.length) break;
          currentFile = files[currentFileIndex];
          currentFd = await fsPromises.open(path.join(sessionDir, currentFile.path), "w");
          currentFileBytesWritten = 0;
        }
        
        const fileRemaining = currentFile.length - currentFileBytesWritten;
        const pieceRemaining = pieceBuffer.length - piecePos;
        const bytesToWrite = Math.min(fileRemaining, pieceRemaining);
        
        await currentFd.write(pieceBuffer, piecePos, bytesToWrite, currentFileBytesWritten);
        
        currentFileBytesWritten += bytesToWrite;
        piecePos += bytesToWrite;
      }

      // Automatically delete the piece right after it's stitched to keep the SSD usage at exactly 1x
      await fsPromises.unlink(piecePath).catch(() => {});
    }
    
    await fsPromises.rm(path.join(sessionDir, "pieces"), { recursive: true, force: true }).catch(() => {});
  } finally {
    if (currentFd !== undefined) {
      await currentFd.close().catch(() => {});
    }
  }
};
