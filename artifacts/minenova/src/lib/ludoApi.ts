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
  diceValue: number | null;                // active die value (= diceQueue[0])
  diceValues: [number, number] | null;     // both rolled dice (for display)
  diceQueue: number[];                     // ordered: [d1?, d2?, bonus6...] primaries first
  dieIndexQueue: Array<0 | 1 | null>;     // parallel: which visual die each slot is (null = bonus)
  movesLeft: number;                       // = diceQueue.length (UI convenience)
  activeDieIndex: 0 | 1 | null;            // = dieIndexQueue[0], which die face is highlighted
  primaryMoveNumber: number;               // 1 = first primary, 2 = second primary, 0 = bonus phase
  primaryMovesTotal: number;               // how many primary dice had valid moves (0, 1, or 2)
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

export interface LudoSettings {
  platformFeePct: number;
  winPct: number;
  minFee: number;
  maxFee: number;
  soloFee: number;
  soloEnabled: boolean;
  timeoutMinutes: number;
}

function getToken(): string {
  return localStorage.getItem("minenova_token") ?? "";
}

export async function fetchLudoSettings(): Promise<LudoSettings> {
  const res = await fetch("/api/ludo/settings");
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load settings");
  return data as LudoSettings;
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

export async function sendLudoSignal(gameId: number, type: string, payload: unknown): Promise<void> {
  await ludoApi(`/ludo/games/${gameId}/signal`, {
    method: "POST",
    body: JSON.stringify({ type, payload }),
  });
}

export function getSSEUrl(gameId: number): string {
  const token = getToken();
  return `/api/ludo/games/${gameId}/events?token=${encodeURIComponent(token)}`;
}
