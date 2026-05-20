import bencode from "bencode";
import type { PeerConnection } from "../peer";
import type { PexPeer, PexState } from "./types";

const EXTENSION_HANDSHAKE_ID = 0;
const UT_PEX_NAME = "ut_pex";

export const sendExtensionHandshake = (peerKey: string, connection: PeerConnection): void => {
  const handshake = {
    m: {
      [UT_PEX_NAME]: 1,
    },
    v: "RawTorrent 1.0",
    reqq: 250,
  };

  const encoded = bencode.encode(handshake);
  const message = Buffer.alloc(6 + encoded.length);

  message.writeUInt32BE(2 + encoded.length, 0);
  message.writeUInt8(20, 4);
  message.writeUInt8(EXTENSION_HANDSHAKE_ID, 5);
  encoded.copy(message, 6);

  connection.socket.write(message);
  void peerKey;
};

export const decodeExtensionHandshake = (data: Buffer): { peerExtensionId: number | null; clientName: string } => {
  const decoded = bencode.decode(data) as { m?: { ut_pex?: number }; v?: Buffer };

  const peerExtensionId = decoded.m && typeof decoded.m[UT_PEX_NAME] === "number" ? decoded.m[UT_PEX_NAME] : null;
  const clientName = decoded.v ? decoded.v.toString() : "unknown";

  return { peerExtensionId, clientName };
};

export const decodePexPeers = (data: Buffer): PexPeer[] => {
  const decoded = bencode.decode(data) as { added?: Buffer; "added.f"?: Buffer; dropped?: Buffer };
  const newPeers: PexPeer[] = [];

  if (decoded.added && Buffer.isBuffer(decoded.added)) {
    for (let i = 0; i + 6 <= decoded.added.length; i += 6) {
      const ip = `${decoded.added[i]}.${decoded.added[i + 1]}.${decoded.added[i + 2]}.${decoded.added[i + 3]}`;
      const port = decoded.added.readUInt16BE(i + 4);

      if (port > 0 && port < 65536) {
        newPeers.push({ ip, port });
      }
    }
  }

  return newPeers;
};

export const buildPexMessage = (state: PexState, peers: PexPeer[]): Buffer => {
  const peersToSend = peers.slice(0, 50);
  const added = Buffer.alloc(peersToSend.length * 6);

  peersToSend.forEach((peer, i) => {
    const parts = peer.ip.split(".").map(Number);
    added[i * 6] = parts[0];
    added[i * 6 + 1] = parts[1];
    added[i * 6 + 2] = parts[2];
    added[i * 6 + 3] = parts[3];
    added.writeUInt16BE(peer.port, i * 6 + 4);
  });

  const pexData = { added };
  const encoded = bencode.encode(pexData);

  const message = Buffer.alloc(6 + encoded.length);
  message.writeUInt32BE(2 + encoded.length, 0);
  message.writeUInt8(20, 4);
  message.writeUInt8(state.peerExtensionId ?? 0, 5);
  encoded.copy(message, 6);

  return message;
};

export const getExtensionMessageId = (payload: Buffer): number | null => {
  if (payload.length < 1) {
    return null;
  }

  return payload.readUInt8(0);
};

export const getExtensionPayload = (payload: Buffer): Buffer => payload.subarray(1);

export const getExtensionHandshakeId = () => EXTENSION_HANDSHAKE_ID;
