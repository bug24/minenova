const API_BASE = "/api";

export async function triviaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("minenova_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export interface TriviaQuestion {
  id: number;
  question: string;
  options: string[];
  category: string;
  difficulty: string;
}

export interface TriviaChallenge {
  id: number;
  creatorId: number;
  creatorUsername: string;
  entryFee: number;
  status: string;
  createdAt: string;
}

export interface TriviaGame {
  id: number;
  mode: "bot" | "pvp";
  status: "active" | "completed";
  player1Id: number;
  player2Id: number | null;
  entryFee: number;
  questionIds: number[];
  player1Answers: (number | null)[];
  player2Answers: (number | null)[];
  player1Score: number;
  player2Score: number;
  winnerId: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface TriviaGameResult extends TriviaGame {
  questions: (TriviaQuestion & { correctIndex: number })[];
  payout: number;
  profit: number;
  opponentUsername?: string;
}

export interface TriviaSettings {
  enabled: boolean;
  minFee: number;
  maxFee: number;
  feePct: number;
}

export async function fetchTriviaSettings(): Promise<TriviaSettings> {
  return triviaApi<TriviaSettings>("/trivia/settings");
}
