export const getBackendHttpUrl = () =>
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? "http://localhost:4000";

export const getBackendWsUrl = () => {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (explicit) {
    return explicit;
  }

  const httpUrl = getBackendHttpUrl();
  return httpUrl.startsWith("https://")
    ? httpUrl.replace("https://", "wss://")
    : httpUrl.replace("http://", "ws://");
};

export type BackendEvent = {
  type: string;
  sessionId?: string;
  timestamp: number;
  data: Record<string, unknown>;
};
