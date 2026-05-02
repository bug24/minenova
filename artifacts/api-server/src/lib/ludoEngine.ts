export type PlayerColor = "red" | "blue";
export type GameStatus = "active" | "completed";

export interface PieceState {
  progress: number;
}

export interface PlayerState {
  userId: number;
  color: PlayerColor;
  pieces: [PieceState, PieceState, PieceState, PieceState];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  currentTurn: 0 | 1;
  diceValue: number | null;
  diceRolled: boolean;
  status: GameStatus;
  winnerId: number | null;
  lastMoveAt: string | null;
}

const ENTRY_POINTS: [number, number] = [0, 13];
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const TRACK_SIZE = 52;
const FINISHED_PROGRESS = 57;

export function createInitialState(redUserId: number, blueUserId: number): GameState {
  const makePlayer = (userId: number, color: PlayerColor): PlayerState => ({
    userId,
    color,
    pieces: [
      { progress: -1 },
      { progress: -1 },
      { progress: -1 },
      { progress: -1 },
    ],
  });

  return {
    players: [makePlayer(redUserId, "red"), makePlayer(blueUserId, "blue")],
    currentTurn: 0,
    diceValue: null,
    diceRolled: false,
    status: "active",
    winnerId: null,
    lastMoveAt: null,
  };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function getAbsolutePosition(playerIndex: 0 | 1, progress: number): number | null {
  if (progress < 0 || progress >= TRACK_SIZE) return null;
  return (ENTRY_POINTS[playerIndex] + progress) % TRACK_SIZE;
}

export function getValidMoves(state: GameState, playerIndex: 0 | 1, diceValue: number): number[] {
  const player = state.players[playerIndex];
  const valid: number[] = [];

  for (let i = 0; i < 4; i++) {
    const progress = player.pieces[i].progress;

    if (progress === -1) {
      if (diceValue === 6) valid.push(i);
    } else if (progress + diceValue <= FINISHED_PROGRESS) {
      valid.push(i);
    }
  }

  return valid;
}

export function applyMove(
  state: GameState,
  playerIndex: 0 | 1,
  pieceIndex: number,
  diceValue: number,
): { newState: GameState; captured: boolean; won: boolean; fromProgress: number; toProgress: number } {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
  const piece = newState.players[playerIndex].pieces[pieceIndex];
  const fromProgress = piece.progress;
  let captured = false;

  if (piece.progress === -1 && diceValue === 6) {
    piece.progress = 0;
  } else {
    piece.progress += diceValue;
  }

  const toProgress = piece.progress;

  if (piece.progress >= 0 && piece.progress < TRACK_SIZE) {
    const absPos = getAbsolutePosition(playerIndex, piece.progress)!;

    if (!SAFE_SQUARES.has(absPos)) {
      const oppPieces = newState.players[opponentIndex].pieces;
      for (let j = 0; j < 4; j++) {
        const oppProgress = oppPieces[j].progress;
        if (oppProgress >= 0 && oppProgress < TRACK_SIZE) {
          const oppAbs = getAbsolutePosition(opponentIndex, oppProgress);
          if (oppAbs === absPos) {
            oppPieces[j].progress = -1;
            captured = true;
          }
        }
      }
    }
  }

  const won = newState.players[playerIndex].pieces.every(p => p.progress === FINISHED_PROGRESS);

  if (won) {
    newState.status = "completed";
    newState.winnerId = newState.players[playerIndex].userId;
  } else if (diceValue === 6) {
    // Standard Ludo rule: rolling a 6 grants an extra turn
    // currentTurn stays with the same player
  } else {
    newState.currentTurn = opponentIndex;
  }

  newState.diceRolled = false;
  newState.diceValue = null;

  return { newState, captured, won, fromProgress, toProgress };
}

export function applyDiceRoll(state: GameState, diceValue: number, now: string): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  newState.diceValue = diceValue;
  newState.diceRolled = true;
  newState.lastMoveAt = now;

  const validMoves = getValidMoves(newState, newState.currentTurn, diceValue);
  if (validMoves.length === 0) {
    newState.currentTurn = newState.currentTurn === 0 ? 1 : 0;
    newState.diceRolled = false;
    newState.diceValue = null;
  }

  return newState;
}

export function forfeit(state: GameState, forfeiterUserId: number): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const winner = newState.players.find(p => p.userId !== forfeiterUserId);
  newState.status = "completed";
  newState.winnerId = winner?.userId ?? null;
  return newState;
}

export function isTimedOut(state: GameState): boolean {
  if (!state.lastMoveAt || !state.diceRolled) return false;
  return Date.now() - new Date(state.lastMoveAt).getTime() > 3 * 60 * 1000;
}

export function sanitizeForPlayer(state: GameState): GameState {
  return state;
}
