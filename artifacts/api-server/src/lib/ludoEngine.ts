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
  diceValue: number | null;                // active die value (= diceQueue[0] or null)
  diceValues: [number, number] | null;     // both rolled dice (for display)
  diceQueue: number[];                     // ordered die values: [d1?, d2?, bonus6...] primaries first
  dieIndexQueue: Array<0 | 1 | null>;     // parallel to diceQueue: which visual die each slot is (null = bonus)
  movesLeft: number;                       // = diceQueue.length (kept for UI convenience)
  activeDieIndex: 0 | 1 | null;            // = dieIndexQueue[0], which die face is highlighted
  primaryMoveNumber: number;               // 1 = on first primary, 2 = on second primary, 0 = bonus phase
  primaryMovesTotal: number;               // how many primary dice had valid moves (0, 1, or 2)
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
    diceQueue: [],
    dieIndexQueue: [],
    movesLeft: 0,
    activeDieIndex: null,
    primaryMoveNumber: 0,
    primaryMovesTotal: 0,
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

/**
 * Build the raw full queue for a turn: both primary dice in roll order, then bonus 6s.
 * Validity is NOT checked here — dice are always included unconditionally.
 * Validity is checked lazily: at roll time (to find starting position) and at each move step.
 * This ensures that a die whose value has no moves before the first move can still become
 * valid after an earlier die spawns or advances a piece.
 */
function buildDiceQueue(
  d1: number,
  d2: number,
): { queue: number[]; dieIndexQueue: Array<0 | 1 | null> } {
  const queue: number[] = [d1, d2];
  const dieIndexQueue: Array<0 | 1 | null> = [0, 1];
  // Bonus 6s appended after both primary dice
  if (d1 === 6) { queue.push(6); dieIndexQueue.push(null); }
  if (d2 === 6) { queue.push(6); dieIndexQueue.push(null); }
  return { queue, dieIndexQueue };
}

export function applyMove(
  state: GameState,
  playerIndex: 0 | 1,
  pieceIndex: number,
  diceValue: number,
): { newState: GameState; captured: boolean; captureWin: boolean; won: boolean; fromProgress: number; toProgress: number } {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
  const piece = newState.players[playerIndex].pieces[pieceIndex];
  const fromProgress = piece.progress;
  let captured = false;
  let captureWin = false;

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
            piece.progress = FINISHED_PROGRESS;   // capturing piece jumps to finish
            captured = true;
            captureWin = true;
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
    newState.diceQueue = [];
    newState.dieIndexQueue = [];
    newState.movesLeft = 0;
    newState.activeDieIndex = null;
    newState.primaryMoveNumber = 0;
  } else {
    // Remove the consumed die from the front of both parallel queues
    // (compat: if dieIndexQueue missing in old persisted state, fill with nulls)
    const prevQueue = newState.diceQueue ?? [];
    const prevDieIndexQueue: Array<0 | 1 | null> = newState.dieIndexQueue ?? prevQueue.map(() => null);
    const consumedDieIndex: 0 | 1 | null = prevDieIndexQueue[0] ?? null;
    const remainingQueue = prevQueue.slice(1);
    const remainingDieIndexQueue = prevDieIndexQueue.slice(1);

    // Skip any remaining entries that have no valid moves after this move
    let validStartIdx = -1;
    for (let k = 0; k < remainingQueue.length; k++) {
      if (getValidMoves(newState, playerIndex, remainingQueue[k]).length > 0) {
        validStartIdx = k;
        break;
      }
    }

    if (validStartIdx >= 0) {
      const nextQueue = remainingQueue.slice(validStartIdx);
      const nextDieIndexQueue = remainingDieIndexQueue.slice(validStartIdx);
      const nextDieIndex: 0 | 1 | null = nextDieIndexQueue[0] ?? null;

      // Advance primaryMoveNumber: consumed a primary → if next is also primary, increment
      let nextPrimaryMoveNumber: number;
      if (consumedDieIndex !== null) {
        // consumed a primary die
        nextPrimaryMoveNumber = nextDieIndex !== null ? newState.primaryMoveNumber + 1 : 0;
      } else {
        // consumed a bonus — primary phase is already done
        nextPrimaryMoveNumber = 0;
      }

      newState.diceQueue = nextQueue;
      newState.dieIndexQueue = nextDieIndexQueue;
      newState.movesLeft = nextQueue.length;
      newState.diceValue = nextQueue[0];
      newState.activeDieIndex = nextDieIndex;
      newState.primaryMoveNumber = nextPrimaryMoveNumber;
      // diceRolled stays true — still same player's turn
    } else {
      // All moves consumed or no valid moves left — end turn
      newState.diceQueue = [];
      newState.dieIndexQueue = [];
      newState.movesLeft = 0;
      newState.diceRolled = false;
      newState.diceValue = null;
      newState.activeDieIndex = null;
      newState.primaryMoveNumber = 0;
      newState.currentTurn = opponentIndex;
    }
  }

  return { newState, captured, captureWin, won, fromProgress, toProgress };
}

export function applyDiceRoll(state: GameState, diceValues: [number, number], now: string): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const [d1, d2] = diceValues;
  newState.diceValues = diceValues;
  newState.lastMoveAt = now;

  const { queue, dieIndexQueue } = buildDiceQueue(d1, d2);

  // Find the first queue entry that has valid moves in the current (pre-move) board state.
  // Only entries BEFORE a valid one are truly unreachable (no move could ever unlock them
  // since no move has been made yet). Entries AFTER startIdx are kept and re-evaluated lazily.
  let startIdx = -1;
  for (let k = 0; k < queue.length; k++) {
    if (getValidMoves(newState, newState.currentTurn, queue[k]).length > 0) {
      startIdx = k;
      break;
    }
  }

  if (startIdx < 0) {
    // No valid moves at all — skip turn
    newState.currentTurn = newState.currentTurn === 0 ? 1 : 0;
    newState.diceRolled = false;
    newState.diceValues = null;
    newState.diceValue = null;
    newState.diceQueue = [];
    newState.dieIndexQueue = [];
    newState.movesLeft = 0;
    newState.activeDieIndex = null;
    newState.primaryMoveNumber = 0;
    newState.primaryMovesTotal = 0;
    return newState;
  }

  const startQueue = queue.slice(startIdx);
  const startDieIndexQueue = dieIndexQueue.slice(startIdx);
  const primaryMovesTotal = startDieIndexQueue.filter(x => x !== null).length;

  newState.diceQueue = startQueue;
  newState.dieIndexQueue = startDieIndexQueue;
  newState.movesLeft = startQueue.length;
  newState.diceValue = startQueue[0];
  newState.activeDieIndex = startDieIndexQueue[0] ?? null;
  newState.primaryMoveNumber = 1;
  newState.primaryMovesTotal = primaryMovesTotal;
  newState.diceRolled = true;
  return newState;
}

/**
 * Force-end the current player's turn without a move.
 * Used as a safety valve when validMoves is empty but diceRolled is true
 * (can happen with old persisted game states that predate the diceQueue field).
 */
export function forceEndTurn(state: GameState): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const opponentIndex: 0 | 1 = newState.currentTurn === 0 ? 1 : 0;
  newState.diceRolled = false;
  newState.diceQueue = [];
  newState.dieIndexQueue = [];
  newState.movesLeft = 0;
  newState.diceValue = null;
  newState.activeDieIndex = null;
  newState.primaryMoveNumber = 0;
  newState.currentTurn = opponentIndex;
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
