export interface DhtLike {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  listen: (port?: number) => void;
  lookup: (infoHash: string | Buffer) => void;
  destroy: () => void;
}
