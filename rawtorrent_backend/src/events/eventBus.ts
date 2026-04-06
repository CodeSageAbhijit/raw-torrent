import { EventEmitter } from "node:events";
import type { TorrentEvent } from "../types/torrent";

const eventSourceId = `backend-${process.pid}-${Date.now()}`;

export const backendEventBus = new EventEmitter();

export const publishEvent = async <TData>(event: TorrentEvent<TData>) => {
  const payload: TorrentEvent<TData> = {
    ...event,
    source: event.source ?? eventSourceId,
  };

  backendEventBus.emit("event", payload);
  return payload;
};
