import Redis from "ioredis";
import { publisherInstanceId } from "./publisher";
import { logger } from "../utils/logger";
import type { TorrentEvent } from "../types/torrent";

const redisUrl = process.env.REDIS_URL;

const redisSubscriber = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    })
  : null;

if (redisSubscriber) {
  redisSubscriber.on("error", (error) => {
    logger.warn("Redis subscriber error", error);
  });
}

export const initSubscriber = (onMessage: (event: TorrentEvent) => void) => {
  if (!redisSubscriber) {
    logger.info("Redis is disabled. Using in-process event bus only.");
    return null;
  }

  redisSubscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as TorrentEvent;

      if (event.source === publisherInstanceId) {
        return;
      }

      onMessage(event);
    } catch (error) {
      logger.warn("Failed to parse Redis message", error);
    }
  });

  void redisSubscriber
    .subscribe("torrent-events")
    .catch((error) => logger.warn("Failed to subscribe to torrent-events", error));

  return redisSubscriber;
};

export const getRedisSubscriber = () => redisSubscriber;
