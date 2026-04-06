import type { TorrentEvent, TorrentSessionState } from "../types/torrent";

const memorySessions = new Map<string, TorrentSessionState>();
const memoryUserIndex = new Map<string, Set<string>>();
const memoryEvents = new Map<string, TorrentEvent<unknown>[]>();
const MAX_SESSION_EVENTS = 120;

const ensureUserIndex = (userId: string) => {
  if (!memoryUserIndex.has(userId)) {
    memoryUserIndex.set(userId, new Set());
  }

  return memoryUserIndex.get(userId)!;
};

const removeFromAnyUserIndex = (sessionId: string) => {
  for (const [indexUserId, known] of memoryUserIndex.entries()) {
    if (!known.has(sessionId)) {
      continue;
    }

    known.delete(sessionId);
    if (known.size === 0) {
      memoryUserIndex.delete(indexUserId);
    }
  }
};

export const persistSession = async (session: TorrentSessionState) => {
  memorySessions.set(session.sessionId, session);

  if (session.userId) {
    ensureUserIndex(session.userId).add(session.sessionId);
  } else {
    removeFromAnyUserIndex(session.sessionId);
  }
};

export const loadSession = async (sessionId: string): Promise<TorrentSessionState | null> => {
  return memorySessions.get(sessionId) ?? null;
};

export const listSessionsByUser = async (userId: string): Promise<TorrentSessionState[]> => {
  const memoryIds = Array.from(memoryUserIndex.get(userId) ?? []);
  return memoryIds
    .map((sessionId) => memorySessions.get(sessionId))
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
  memoryEvents.set(event.sessionId, events.slice(-MAX_SESSION_EVENTS));
};

export const listSessionEvents = async (sessionId: string): Promise<TorrentEvent<unknown>[]> => {
  return memoryEvents.get(sessionId) ?? [];
};

export const deleteSessionPersistence = async (sessionId: string, userId?: string) => {
  const sessionFromMemory = memorySessions.get(sessionId);
  const resolvedUserId = userId ?? sessionFromMemory?.userId;

  memorySessions.delete(sessionId);
  memoryEvents.delete(sessionId);

  if (resolvedUserId) {
    const known = memoryUserIndex.get(resolvedUserId);
    if (known) {
      known.delete(sessionId);
      if (known.size === 0) {
        memoryUserIndex.delete(resolvedUserId);
      }
    }
  } else {
    removeFromAnyUserIndex(sessionId);
  }
};
