const normalizeUrl = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/$/, "");
};

export const getBackendHttpUrl = () => normalizeUrl(process.env.NEXT_PUBLIC_BACKEND_HTTP_URL) ?? "/api";

export const getBackendWsUrl = () => {
  const explicit = normalizeUrl(process.env.NEXT_PUBLIC_BACKEND_WS_URL);
  if (explicit) {
    return explicit;
  }

  const httpUrl = getBackendHttpUrl();
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace("https://", "wss://");
  }

  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace("http://", "ws://");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPort = normalizeUrl(process.env.NEXT_PUBLIC_BACKEND_WS_PORT)?.replace(/\//g, "");
    const host = window.location.hostname;
    if (wsPort) {
      return `${protocol}//${host}:${wsPort}`;
    }
    return `${protocol}//${host}:4000`;
  }

  return "ws://localhost:4000";
};

export type BackendEvent = {
  type: string;
  sessionId?: string;
  timestamp: number;
  data: Record<string, unknown>;
};
