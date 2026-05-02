export interface LudoChallenge {
  id: number;
  creatorId: number;
  creatorUsername: string;
  entryFee: number;
  status: string;
  createdAt: string;
}

export interface PieceState {
  progress: number;
}

export interface PlayerState {
  userId: number;
  color: string;
  pieces: [PieceState, PieceState, PieceState, PieceState];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  currentTurn: 0 | 1;
  diceValue: number | null;
  diceRolled: boolean;
  status: string;
  winnerId: number | null;
  lastMoveAt: string | null;
}

export interface LudoGame {
  id: number;
  challengeId: number;
  redPlayerId: number;
  bluePlayerId: number;
  boardState: GameState;
  status: string;
  winnerId: number | null;
  entryFee: number;
  startedAt: string;
  endedAt: string | null;
}

function getToken(): string {
  return localStorage.getItem("minenova_token") ?? "";
}

export async function ludoApi<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export function getValidMovesClient(
  state: GameState,
  playerIndex: 0 | 1,
  diceValue: number,
): number[] {
  const player = state.players[playerIndex];
  const valid: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = player.pieces[i].progress;
    if (p === -1) { if (diceValue === 6) valid.push(i); }
    else if (p + diceValue <= 57) valid.push(i);
  }
  return valid;
}

export function getSSEUrl(gameId: number): string {
  const token = getToken();
  return `/api/ludo/games/${gameId}/events?token=${encodeURIComponent(token)}`;
}
