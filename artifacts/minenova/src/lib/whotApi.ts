export type WhotSuit = "Circle" | "Triangle" | "Cross" | "Square" | "Star";
export type WhotCardSuit = WhotSuit | "WHOT";

export interface WhotCard {
  suit: WhotCardSuit;
  value: number;
}

export interface WhotPlayerState {
  userId: number;
  hand: WhotCard[];
}

export interface WhotGameState {
  players: [WhotPlayerState, WhotPlayerState];
  deck: WhotCard[];
  discardPile: WhotCard[];
  currentTurn: 0 | 1;
  calledSuit: WhotSuit | null;
  pendingPickCount: number;
  status: "active" | "completed";
  winnerId: number | null;
  lastMoveAt: string | null;
}

export interface WhotChallenge {
  id: number;
  creatorId: number;
  creatorUsername: string;
  entryFee: number;
  status: string;
  createdAt: string;
}

export interface WhotGame {
  id: number;
  challengeId: number | null;
  player0Id: number;
  player1Id: number;
  gameState: WhotGameState;
  status: string;
  winnerId: number | null;
  entryFee: number;
  startedAt: string;
  endedAt: string | null;
}

export interface WhotSettings {
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

export async function fetchWhotSettings(): Promise<WhotSettings> {
  const res = await fetch("/api/whot/settings");
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load settings");
  return data as WhotSettings;
}

export async function whotApi<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
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

export async function sendWhotSignal(gameId: number, type: string, payload: unknown): Promise<void> {
  await whotApi(`/whot/games/${gameId}/signal`, {
    method: "POST",
    body: JSON.stringify({ type, payload }),
  });
}

export function getWhotSSEUrl(gameId: number): string {
  const token = getToken();
  return `/api/whot/games/${gameId}/events?token=${encodeURIComponent(token)}`;
}

export function topCard(state: WhotGameState): WhotCard {
  return state.discardPile[state.discardPile.length - 1];
}

export function effectiveSuit(state: WhotGameState): WhotCardSuit {
  const top = topCard(state);
  if (top.suit === "WHOT" && state.calledSuit) return state.calledSuit;
  return top.suit;
}

export function isCardPlayable(card: WhotCard, state: WhotGameState): boolean {
  if (state.pendingPickCount > 0) {
    return card.value === 2 || card.value === 5;
  }
  if (card.suit === "WHOT") return true;
  const top = topCard(state);
  const eSuit = effectiveSuit(state);
  if (eSuit !== "WHOT" && card.suit === eSuit) return true;
  if (card.value === top.value) return true;
  return false;
}

export const SUIT_SYMBOLS: Record<WhotCardSuit, string> = {
  Circle: "○",
  Triangle: "△",
  Cross: "✕",
  Square: "□",
  Star: "★",
  WHOT: "W",
};

export const SUIT_COLORS: Record<WhotCardSuit, string> = {
  Circle: "#e11d48",
  Triangle: "#7c3aed",
  Cross: "#0ea5e9",
  Square: "#d97706",
  Star: "#16a34a",
  WHOT: "#ec4899",
};
