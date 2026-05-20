import type { PieceState, PeerDownloadState } from "./types";
import { getGlobalSettings } from "../../settings";
import { estimateDiscoveredPeers, inferPeerEncryption, parsePeerAddress } from "./peerUtils";

type TorrentLike = any;

const DETAILED_PIECE_TRACKING_LIMIT = 250000;

const toFixedOne = (value: number) => Number(value.toFixed(1));

const formatEta = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "calculating...";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

export const updatePieceStatesInPlace = (torrent: TorrentLike, states: PieceState[]): PieceState[] => {
  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  const pieceLength = Number(torrent?.pieceLength ?? 0);

  if (piecesTotal <= 0) {
    return [];
  }

  if (piecesTotal > DETAILED_PIECE_TRACKING_LIMIT) {
    states.length = 0;
    return states;
  }

  if (states.length !== piecesTotal) {
    for (let index = 0; index < piecesTotal; index += 1) {
      states.push({
        index,
        hash: "",
        length: pieceLength,
        requested: false,
        completed: Boolean(torrent?.bitfield?.get?.(index)),
      });
    }
    return states;
  }

  for (let index = 0; index < piecesTotal; index += 1) {
    states[index].completed = Boolean(torrent?.bitfield?.get?.(index));
  }

  return states;
};

export const updatePeerStatesInPlace = (torrent: TorrentLike, states: PeerDownloadState[]): PeerDownloadState[] => {
  const wires: any[] = Array.isArray(torrent?.wires) ? torrent.wires : [];
  const pieceUniverse = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);

  const previousByPeer = new Map<string, PeerDownloadState>();
  for (const state of states) {
    previousByPeer.set(`${state.ip}:${state.port}`, state);
  }

  states.length = 0;
  for (const wire of wires) {
    const address = parsePeerAddress(wire?.remoteAddress);
    const remotePort = Number(wire?.remotePort ?? wire?._socket?.remotePort ?? 0);
    const resolvedPort = address.port > 0 ? address.port : remotePort;
    const previous = previousByPeer.get(`${address.ip}:${resolvedPort}`);

    const peerPieces = wire?.peerPieces;
    let piecesAvailable = previous?.piecesAvailable ?? 0;
    let piecesAvailableKnown = previous?.piecesAvailableKnown ?? false;

    if (Array.isArray(peerPieces)) {
      piecesAvailable = peerPieces.filter(Boolean).length;
      piecesAvailableKnown = true;
    } else if (peerPieces && typeof peerPieces.get === "function" && pieceUniverse > 0 && !piecesAvailableKnown) {
      let count = 0;
      for (let index = 0; index < pieceUniverse; index += 1) {
        if (peerPieces.get(index)) {
          count += 1;
        }
      }
      piecesAvailable = count;
      piecesAvailableKnown = true;
    }

    if (!piecesAvailableKnown && Number(wire?.downloaded ?? 0) > 0) {
      piecesAvailable = Math.max(1, piecesAvailable);
    }

    states.push({
      ip: address.ip,
      port: resolvedPort,
      peerId: wire?.peerId,
      choked: Boolean(wire?.peerChoking),
      piecesAvailable,
      piecesAvailableKnown,
      downloadedBytes: Number(wire?.downloaded ?? 0),
      pendingRequests: Array.isArray(wire?.requests) ? wire.requests.length : 0,
      encryption: inferPeerEncryption(wire),
    });
  }

  return states;
};

export const computeProgress = (torrent: TorrentLike) => {
  const totalBytes = Number(torrent?.length ?? 0);
  const downloadedBytes = Number(torrent?.downloaded ?? 0);
  const downloadSpeed = Number(torrent?.downloadSpeed ?? 0);
  const uploadSpeed = Number(torrent?.uploadSpeed ?? 0);
  const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
  const turboMode = getGlobalSettings().turboMode;

  const piecesTotal = Number(torrent?.pieces?.length ?? torrent?.numPieces ?? 0);
  let piecesCompleted = 0;

  if (piecesTotal > 0) {
    if (turboMode) {
      piecesCompleted = Math.max(0, Math.min(piecesTotal, Math.floor((progress / 100) * piecesTotal)));
    } else if (torrent?.bitfield?.get) {
      for (let index = 0; index < piecesTotal; index += 1) {
        if (torrent.bitfield.get(index)) {
          piecesCompleted += 1;
        }
      }
    }
  }

  const activePeers = Number(Array.isArray(torrent?.wires) ? torrent.wires.length : 0);
  const discoveredPeers = Math.max(activePeers, estimateDiscoveredPeers(torrent, activePeers));
  const remaining = Math.max(0, totalBytes - downloadedBytes);
  const eta = downloadSpeed > 0 ? Math.round(remaining / downloadSpeed) : -1;

  return {
    totalBytes,
    downloadedBytes,
    progress: toFixedOne(progress),
    downloadSpeed,
    uploadSpeed,
    activePeers,
    discoveredPeers,
    piecesCompleted,
    piecesTotal,
    eta,
    downloadSpeedMbps: (downloadSpeed / (1024 * 1024)).toFixed(2),
    etaFormatted: formatEta(eta),
  };
};
