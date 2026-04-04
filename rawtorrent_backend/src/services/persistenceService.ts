import type { TorrentEvent, TorrentSessionState } from "../types/torrent";
import { getRedisPublisher } from "../redis/publisher";
import { logger } from "../utils/logger";

const memorySessions = new Map<string, TorrentSessionState>();
const memoryUserIndex = new Map<string, Set<string>>();
const memoryEvents = new Map<string, TorrentEvent<unknown>[]>();
const isBackendStorageDisabled = () => process.env.DISABLE_BACKEND_STORAGE === "true";

const sessionKey = (sessionId: string) => `torrent:session:${sessionId}`;
const userSessionsKey = (userId: string) => `torrent:user:${userId}:sessions`;
const eventsKey = (sessionId: string) => `torrent:events:${sessionId}`;

const withRedis = async <T>(operation: (redis: NonNullable<ReturnType<typeof getRedisPublisher>>) => Promise<T>) => {
  if (isBackendStorageDisabled()) {
    return null;
  }

  const redis = getRedisPublisher();
  if (!redis) {
    return null;
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }

    return await operation(redis);
  } catch (error) {
    logger.warn("Redis persistence operation failed", error);
    return null;
  }
};

export const persistSession = async (session: TorrentSessionState) => {
  memorySessions.set(session.sessionId, session);

  if (session.userId) {
    if (!memoryUserIndex.has(session.userId)) {
      memoryUserIndex.set(session.userId, new Set());
    }
    memoryUserIndex.get(session.userId)?.add(session.sessionId);
  }

  await withRedis(async (redis) => {
    await redis.set(sessionKey(session.sessionId), JSON.stringify(session));

    if (session.userId) {
      await redis.sadd(userSessionsKey(session.userId), session.sessionId);
    }
  });
};

export const loadSession = async (sessionId: string): Promise<TorrentSessionState | null> => {
  const fromMemory = memorySessions.get(sessionId);
  if (fromMemory) {
    return fromMemory;
  }

  const fromRedis = await withRedis(async (redis) => redis.get(sessionKey(sessionId)));
  if (!fromRedis) {
    return null;
  }

  const parsed = JSON.parse(fromRedis) as TorrentSessionState;
  memorySessions.set(sessionId, parsed);

  if (parsed.userId) {
    if (!memoryUserIndex.has(parsed.userId)) {
      memoryUserIndex.set(parsed.userId, new Set());
    }
    memoryUserIndex.get(parsed.userId)?.add(parsed.sessionId);
  }

  return parsed;
};

export const listSessionsByUser = async (userId: string): Promise<TorrentSessionState[]> => {
  const memoryIds = Array.from(memoryUserIndex.get(userId) ?? []);
  const memoryResults = memoryIds
    .map((sessionId) => memorySessions.get(sessionId))
    .filter((session): session is TorrentSessionState => Boolean(session));

  const redisIds = await withRedis(async (redis) => redis.smembers(userSessionsKey(userId)));

  if (!redisIds || redisIds.length === 0) {
    return memoryResults.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const sessions = await Promise.all(redisIds.map((sessionId) => loadSession(sessionId)));
  return sessions
    .filter((session): session is TorrentSessionState => Boolean(session))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const appendSessionEvent = async (event: TorrentEvent<unknown>) => {
  if (!event.sessionId) {
    return;
  }

  if (!memoryEvents.has(event.sessionId)) {
    memoryEvents.set(event.sessionId, []);
  }

  const events = memoryEvents.get(event.sessionId) ?? [];
  events.push(event);
  memoryEvents.set(event.sessionId, events.slice(-120));

  await withRedis(async (redis) => {
    const key = eventsKey(event.sessionId!);
    await redis.rpush(key, JSON.stringify(event));
    await redis.ltrim(key, -120, -1);
  });
};

export const listSessionEvents = async (sessionId: string): Promise<TorrentEvent<unknown>[]> => {
  const memory = memoryEvents.get(sessionId);
  if (memory && memory.length > 0) {
    return memory;
  }

  const rows = await withRedis(async (redis) => redis.lrange(eventsKey(sessionId), 0, -1));
  if (!rows || rows.length === 0) {
    return [];
  }

  const events = rows
    .map((value) => {
      try {
        return JSON.parse(value) as TorrentEvent<unknown>;
      } catch {
        return null;
      }
    })
    .filter((event): event is TorrentEvent<unknown> => event !== null);

  memoryEvents.set(sessionId, events);
  return events;
};
