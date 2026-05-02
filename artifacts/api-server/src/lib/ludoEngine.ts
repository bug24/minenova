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
  diceValue: number | null;              // active die value for the current move
  diceValues: [number, number] | null;   // both rolled dice
  movesLeft: number;                     // moves remaining this turn (0, 1, or 2)
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
    diceValues: null,
    movesLeft: 0,
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

  // Capture check — only for pieces on the open track (0..TRACK_SIZE-1)
  if (piece.progress >= 0 && piece.progress < TRACK_SIZE) {
    const absPos = getAbsolutePosition(playerIndex, piece.progress)!;

    if (!SAFE_SQUARES.has(absPos)) {
      const oppPieces = newState.players[opponentIndex].pieces;
      for (let j = 0; j < 4; j++) {
        const oppProgress = oppPieces[j].progress;
        if (oppProgress >= 0 && oppProgress < TRACK_SIZE) {
          const oppAbs = getAbsolutePosition(opponentIndex, oppProgress);
          if (oppAbs === absPos) {
            oppPieces[j].progress = -1;           // captured piece goes home
            piece.progress = FINISHED_PROGRESS;   // capturing piece instant-wins (goes to finish)
            captured = true;
            break;
          }
        }
      }
    }
  }

  const toProgress = piece.progress;
  const won = newState.players[playerIndex].pieces.every(p => p.progress === FINISHED_PROGRESS);

  if (won) {
    newState.status = "completed";
    newState.winnerId = newState.players[playerIndex].userId;
    newState.diceRolled = false;
    newState.diceValue = null;
    newState.movesLeft = 0;
  } else {
    // movesLeft may be undefined in old persisted states — treat as 1 (single-die compat)
    const currentMovesLeft = (newState.movesLeft ?? 1);
    const newMovesLeft = currentMovesLeft - 1;

    if (newMovesLeft > 0 && newState.diceValues) {
      // Still have moves remaining — advance to next die
      const dieIdx = 2 - newMovesLeft;  // 0-based: first move used index 0, second uses index 1
      const nextDieValue = newState.diceValues[dieIdx] ?? null;
      newState.movesLeft = newMovesLeft;
      newState.diceValue = nextDieValue;

      if (nextDieValue !== null) {
        const nextValid = getValidMoves(newState, playerIndex, nextDieValue);
        if (nextValid.length === 0) {
          // No valid moves with the next die — skip it, switch turn
          newState.movesLeft = 0;
          newState.currentTurn = opponentIndex;
          newState.diceRolled = false;
          newState.diceValue = null;
        }
      }
    } else {
      // All moves consumed
      newState.movesLeft = 0;
      newState.diceRolled = false;
      newState.diceValue = null;

      // 6-bonus: rolling a 6 grants the same player another full turn
      if (diceValue === 6) {
        // currentTurn stays with playerIndex
      } else {
        newState.currentTurn = opponentIndex;
      }
    }
  }

  return { newState, captured, won, fromProgress, toProgress };
}

export function applyDiceRoll(state: GameState, diceValues: [number, number], now: string): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const [d1, d2] = diceValues;
  newState.diceValues = diceValues;
  newState.lastMoveAt = now;

  const validD1 = getValidMoves(newState, newState.currentTurn, d1);
  const validD2 = getValidMoves(newState, newState.currentTurn, d2);

  if (validD1.length === 0 && validD2.length === 0) {
    // No valid moves with either die — skip turn
    newState.currentTurn = newState.currentTurn === 0 ? 1 : 0;
    newState.diceRolled = false;
    newState.diceValues = null;
    newState.diceValue = null;
    newState.movesLeft = 0;
    return newState;
  }

  if (validD1.length === 0) {
    // First die has no moves — skip to second die only
    newState.movesLeft = 1;
    newState.diceValue = d2;
  } else {
    newState.movesLeft = 2;
    newState.diceValue = d1;
  }
  newState.diceRolled = true;
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
