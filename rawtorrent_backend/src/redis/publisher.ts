import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { logger } from "../utils/logger";
import type { TorrentEvent } from "../types/torrent";

export const publisherInstanceId = `${process.pid}-${Date.now()}`;
export const torrentEventBus = new EventEmitter();

const redisUrl = process.env.REDIS_URL;

const redisPublisher = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    })
  : null;

if (redisPublisher) {
  redisPublisher.on("error", (error) => {
    logger.warn("Redis publisher error", error);
  });
}

export const publishEvent = async <TData>(event: TorrentEvent<TData>) => {
  const payload: TorrentEvent<TData> = {
    ...event,
    source: event.source ?? publisherInstanceId,
  };

  torrentEventBus.emit("event", payload);

  if (!redisPublisher) {
    return payload;
  }

  try {
    if (redisPublisher.status === "wait") {
      await redisPublisher.connect();
    }

    await redisPublisher.publish("torrent-events", JSON.stringify(payload));
  } catch (error) {
    logger.warn("Failed to publish torrent event to Redis", error);
  }

  return payload;
};

export const getRedisPublisher = () => redisPublisher;
