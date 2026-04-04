export interface PieceState {
  index: number;
  hash: string;
  length: number;
  requested: boolean;
  completed: boolean;
}

export class PieceManager {
  private readonly pieces: PieceState[];

  constructor(pieceHashes: string[], pieceLength: number, totalLength: number) {
    this.pieces = pieceHashes.map((hash, index) => ({
      index,
      hash,
      length: index === pieceHashes.length - 1 ? totalLength - index * pieceLength : pieceLength,
      requested: false,
      completed: false,
    }));
  }

  getAllPieces() {
    return [...this.pieces];
  }

  getNextPendingPiece() {
    return this.pieces.find((piece) => !piece.requested && !piece.completed) ?? null;
  }

  markRequested(index: number) {
    const piece = this.pieces[index];
    if (piece) {
      piece.requested = true;
    }
  }

  markCompleted(index: number) {
    const piece = this.pieces[index];
    if (piece) {
      piece.completed = true;
      piece.requested = false;
    }
  }

  getProgress() {
    if (this.pieces.length === 0) {
      return 0;
    }

    const completed = this.pieces.filter((piece) => piece.completed).length;
    return Math.round((completed / this.pieces.length) * 100);
  }
}
