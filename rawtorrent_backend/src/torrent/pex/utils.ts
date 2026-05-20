import type { PexPeer } from "./types";

export const parsePeerKey = (value: string): PexPeer => {
  const [ip, portStr] = value.split(":");
  return { ip, port: parseInt(portStr, 10) };
};
