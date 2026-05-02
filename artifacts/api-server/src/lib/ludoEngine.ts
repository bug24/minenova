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
  diceValue: number | null;              // active die value (= diceQueue[0] or null)
  diceValues: [number, number] | null;   // both rolled dice (for display)
  diceQueue: number[];                   // ordered die values remaining this turn (includes 6-bonuses)
  movesLeft: number;                     // = diceQueue.length (kept for UI convenience)
  activeDieIndex: 0 | 1 | null;          // which visual die is currently active (0, 1, or null for bonus)
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
    movesLeft: 0,
    activeDieIndex: null,
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
 * Build the ordered queue of die values for a turn, including 6-bonuses.
 * A die is only added to the queue if it has at least one valid move.
 * If a die shows 6 AND has valid moves, an extra 6 is appended after it.
 */
function buildDiceQueue(
  state: GameState,
  playerIndex: 0 | 1,
  d1: number,
  d2: number,
): { queue: number[]; activeDieIndex: 0 | 1 | null } {
  const queue: number[] = [];
  let activeDieIndex: 0 | 1 | null = null;

  const valid1 = getValidMoves(state, playerIndex, d1);
  const valid2 = getValidMoves(state, playerIndex, d2);

  if (valid1.length > 0) {
    if (activeDieIndex === null) activeDieIndex = 0;
    queue.push(d1);
    if (d1 === 6) queue.push(6); // bonus move for rolling 6 on die 1
  }
  if (valid2.length > 0) {
    if (activeDieIndex === null) activeDieIndex = 1;
    queue.push(d2);
    if (d2 === 6) queue.push(6); // bonus move for rolling 6 on die 2
  }

  return { queue, activeDieIndex };
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
    newState.movesLeft = 0;
    newState.activeDieIndex = null;
  } else {
    // Remove the consumed die from the front of the queue
    // (compat: if diceQueue missing in old persisted state, treat as empty → end turn)
    const prevQueue = newState.diceQueue ?? [];
    const remainingQueue = prevQueue.length > 0 ? prevQueue.slice(1) : [];

    // Skip any remaining dice that have no valid moves after this move
    let validRemainder: number[] = [];
    let nextActiveDieIndex: 0 | 1 | null = null;

    for (let k = 0; k < remainingQueue.length; k++) {
      const queueVal = remainingQueue[k];
      const nextValid = getValidMoves(newState, playerIndex, queueVal);
      if (nextValid.length > 0) {
        validRemainder = remainingQueue.slice(k);
        // Determine which visual die the next value corresponds to
        // The second original die (index 1) is at position [0 or 1] in the original two-die part
        // If current activeDieIndex was 0 (die 1), next is die 2 (index 1) if k=0
        if (newState.activeDieIndex === 0 && k === 0) {
          nextActiveDieIndex = 1;
        } else if (newState.activeDieIndex === 1 && k === 0) {
          // Came from die 2, next is a bonus (no specific visual die)
          nextActiveDieIndex = null;
        } else {
          nextActiveDieIndex = null; // bonus move
        }
        break;
      }
    }

    if (validRemainder.length > 0) {
      newState.diceQueue = validRemainder;
      newState.movesLeft = validRemainder.length;
      newState.diceValue = validRemainder[0];
      newState.activeDieIndex = nextActiveDieIndex;
      // diceRolled stays true — still same player's turn
    } else {
      // All moves consumed or no valid moves left — end turn
      // No diceValue===6 check: 6 bonuses were already baked into the queue at roll time
      newState.diceQueue = [];
      newState.movesLeft = 0;
      newState.diceRolled = false;
      newState.diceValue = null;
      newState.activeDieIndex = null;
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

  const { queue, activeDieIndex } = buildDiceQueue(newState, newState.currentTurn, d1, d2);

  if (queue.length === 0) {
    // No valid moves with either die — skip turn
    newState.currentTurn = newState.currentTurn === 0 ? 1 : 0;
    newState.diceRolled = false;
    newState.diceValues = null;
    newState.diceValue = null;
    newState.diceQueue = [];
    newState.movesLeft = 0;
    newState.activeDieIndex = null;
    return newState;
  }

  newState.diceQueue = queue;
  newState.movesLeft = queue.length;
  newState.diceValue = queue[0];
  newState.activeDieIndex = activeDieIndex;
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
