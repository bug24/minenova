import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Bomb, Gem, TrendingUp, TrendingDown,
  RefreshCw, DollarSign, History, Trophy, Flame, Crown,
} from "lucide-react";
import {
  unlockAudio, playMinesTileClick, playMinesGemReveal,
  playMinesExplosion, playMinesCashout, playWin, playBuzzer,
} from "@/lib/sounds";
import { burstConfetti } from "@/lib/confetti";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
const API_BASE = "/api";

async function minesApi<T>(path: string, init?: RequestInit): Promise<T> {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ActiveGame {
  id: number;
  bet: number;
  mineCount: number;
  revealedTiles: number[];
  currentMultiplier: number;
  potentialPayout: number;
  status: string;
}

interface HistoryEntry {
  id: number;
  bet: number;
  mineCount: number;
  status: "won" | "lost" | "active";
  currentMultiplier: number;
  finalPayout: number | null;
  revealedCount: number;
  profit: number;
  startedAt: string;
}

interface MinesSettings {
  enabled: boolean;
  minBet: number;
  maxBet: number;
  feePct: number;
}

interface LeaderboardEntry {
  rank: number;
  username: string;
  mineCount: number;
  multiplier: number;
  payout: number;
  bet: number;
  profit: number;
  endedAt: string | null;
}

interface Leaderboard {
  today: LeaderboardEntry[];
  allTime: LeaderboardEntry[];
}

const TOTAL_TILES = 25;
const MINE_PRESETS = [1, 3, 5, 10, 15, 24];

// Multiplier formula (client-side preview — houseEdge = 1 - feePct/100)
function calcMultiplier(mineCount: number, revealed: number, houseEdge: number): number {
  if (revealed === 0) return 1;
  let mult = 1;
  for (let k = 0; k < revealed; k++) {
    const safe = TOTAL_TILES - mineCount - k;
    const rem = TOTAL_TILES - k;
    if (safe <= 0 || rem <= 0) return mult;
    mult *= rem / safe;
  }
  return parseFloat((mult * houseEdge).toFixed(4));
}

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------
type TileState = "hidden" | "gem" | "mine" | "revealed-mine";

interface TileProps {
  index: number;
  state: TileState;
  onClick: () => void;
  disabled: boolean;
  animIn?: boolean;
}

function Tile({ index, state, onClick, disabled, animIn }: TileProps) {
  const isHidden = state === "hidden";
  const isGem = state === "gem";
  const isMine = state === "mine" || state === "revealed-mine";
  const isRevealedMine = state === "revealed-mine";

  return (
    <button
      key={index}
      onClick={onClick}
      disabled={disabled || !isHidden}
      className={[
        "relative aspect-square rounded-xl flex items-center justify-center transition-all duration-200 select-none",
        isHidden
          ? "bg-slate-700/80 hover:bg-slate-600/80 active:scale-95 cursor-pointer border border-slate-600/50 hover:border-primary/40 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]"
          : "",
        isGem
          ? `bg-emerald-500/20 border border-emerald-400/60 shadow-[0_0_12px_rgba(52,211,153,0.4)] ${animIn ? "animate-[bounceIn_0.3s_ease-out]" : ""}`
          : "",
        isMine
          ? `bg-red-500/20 border border-red-400/60 shadow-[0_0_12px_rgba(239,68,68,0.4)] ${isRevealedMine ? "opacity-70" : "animate-[bounceIn_0.3s_ease-out]"}`
          : "",
        disabled && isHidden ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {isGem && <Gem className="w-5 h-5 text-emerald-400 sm:w-6 sm:h-6" />}
      {isMine && <Bomb className="w-5 h-5 text-red-400 sm:w-6 sm:h-6" />}
      {isHidden && (
        <div className="w-2 h-2 rounded-full bg-slate-500/60" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// History row
// ---------------------------------------------------------------------------
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const won = entry.status === "won";
  const lost = entry.status === "lost";
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${won ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
        {won ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">
          {entry.bet} coins · {entry.mineCount} mine{entry.mineCount !== 1 ? "s" : ""}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {entry.revealedCount} gem{entry.revealedCount !== 1 ? "s" : ""} found
          {!lost && ` · ${entry.currentMultiplier.toFixed(2)}x`}
        </p>
      </div>
      <span className={`text-xs font-bold shrink-0 ${won ? "text-emerald-400" : "text-red-400"}`}>
        {won ? "+" : ""}{entry.profit.toFixed(0)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MinesGame() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // Game state
  const [phase, setPhase] = useState<"setup" | "playing" | "ended">("setup");
  const [gameId, setGameId] = useState<number | null>(null);
  const [bet, setBet] = useState("100");
  const [mineCount, setMineCount] = useState(3);
  const [revealedTiles, setRevealedTiles] = useState<number[]>([]);
  const [mineTiles, setMineTiles] = useState<number[]>([]);
  const [hitMine, setHitMine] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [potentialPayout, setPotentialPayout] = useState(0);
  const [finalPayout, setFinalPayout] = useState<number | null>(null);
  const [lastNewTile, setLastNewTile] = useState<number | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [settings, setSettings] = useState<MinesSettings>({ enabled: true, minBet: 10, maxBet: 100000, feePct: 3 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [lbTab, setLbTab] = useState<"today" | "allTime">("today");
  const [streak, setStreak] = useState<number>(0);

  const betNum = parseFloat(bet) || 0;

  // Load settings + check for active game + history + leaderboard on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await minesApi<MinesSettings>("/mines/settings");
        setSettings(s);
      } catch { /* ignore */ }

      try {
        const { game } = await minesApi<{ game: ActiveGame | null }>("/mines/active");
        if (game) {
          setGameId(game.id);
          setBet(String(game.bet));
          setMineCount(game.mineCount);
          setRevealedTiles(game.revealedTiles);
          setMultiplier(game.currentMultiplier);
          setPotentialPayout(game.potentialPayout);
          setPhase("playing");
        }
      } catch { /* ignore */ }

      await Promise.all([loadHistory(), loadLeaderboard(), loadStreak()]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await minesApi<HistoryEntry[]>("/mines/history");
      setHistory(data.filter(g => g.status !== "active"));
    } catch { /* ignore */ }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await minesApi<Leaderboard>("/mines/leaderboard");
      setLeaderboard(data);
    } catch { /* ignore */ }
  }, []);

  const loadStreak = useCallback(async () => {
    try {
      const data = await minesApi<{ streak: number }>("/mines/streak");
      setStreak(data.streak);
    } catch { /* ignore */ }
  }, []);

  // Preview multiplier in setup mode — uses server-configured fee
  const previewMultiplier = useCallback((mines: number, revealed: number) => {
    return calcMultiplier(mines, revealed, 1 - settings.feePct / 100);
  }, [settings.feePct]);

  const handleStart = useCallback(async () => {
    if (loading) return;
    if (!betNum || betNum <= 0) { toast({ variant: "destructive", title: "Enter a valid amount" }); return; }
    if (betNum < settings.minBet) { toast({ variant: "destructive", title: `Minimum entry is ${settings.minBet} coins` }); return; }
    if (betNum > settings.maxBet) { toast({ variant: "destructive", title: `Maximum entry is ${settings.maxBet} coins` }); return; }

    setLoading(true);
    try {
      const data = await minesApi<{ gameId: number }>("/mines/start", {
        method: "POST",
        body: JSON.stringify({ bet: betNum, mineCount }),
      });
      setGameId(data.gameId);
      setRevealedTiles([]);
      setMineTiles([]);
      setHitMine(null);
      setMultiplier(1);
      setPotentialPayout(betNum);
      setFinalPayout(null);
      setLastNewTile(null);
      setPhase("playing");
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [loading, betNum, mineCount, settings, toast, queryClient]);

  const handleReveal = useCallback(async (tileIndex: number) => {
    if (revealing || phase !== "playing" || !gameId) return;
    unlockAudio();
    playMinesTileClick();
    setRevealing(true);
    try {
      const data = await minesApi<{
        result: "gem" | "mine";
        tileIndex: number;
        revealedTiles: number[];
        minePositions: number[];
        multiplier: number;
        potentialPayout?: number;
        payout?: number;
        status: string;
        autoWin?: boolean;
      }>("/mines/reveal", {
        method: "POST",
        body: JSON.stringify({ gameId, tileIndex }),
      });

      setLastNewTile(tileIndex);

      if (data.result === "mine") {
        playMinesExplosion();
        playBuzzer();
        setHitMine(tileIndex);
        setMineTiles(data.minePositions);
        setRevealedTiles(data.revealedTiles);
        setMultiplier(0);
        setFinalPayout(0);
        setPhase("ended");
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        loadHistory();
        loadStreak();
        loadLeaderboard();
      } else {
        playMinesGemReveal();
        setRevealedTiles(data.revealedTiles);
        setMultiplier(data.multiplier);
        setPotentialPayout(data.potentialPayout ?? data.payout ?? 0);

        if (data.status === "won") {
          playMinesCashout();
          playWin();
          burstConfetti();
          setMineTiles(data.minePositions);
          setFinalPayout(data.payout ?? 0);
          setPhase("ended");
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
          loadHistory();
          loadStreak();
          loadLeaderboard();
          toast({ title: `All gems found! Auto cash out: +${data.payout?.toFixed(0)} coins` });
        }
      }
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setRevealing(false);
    }
  }, [revealing, phase, gameId, queryClient, loadHistory, toast]);

  const handleCashOut = useCallback(async () => {
    if (cashingOut || phase !== "playing" || !gameId || revealedTiles.length === 0) return;
    setCashingOut(true);
    try {
      const data = await minesApi<{ payout: number; multiplier: number; minePositions: number[] }>(
        "/mines/cashout",
        { method: "POST", body: JSON.stringify({ gameId }) },
      );
      playMinesCashout();
      playWin();
      burstConfetti();
      setMineTiles(data.minePositions);
      setFinalPayout(data.payout);
      setMultiplier(data.multiplier);
      setPhase("ended");
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      loadHistory();
      loadStreak();
      loadLeaderboard();
      toast({ title: `Cashed out! +${data.payout.toFixed(0)} coins (${data.multiplier.toFixed(2)}x)` });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCashingOut(false);
    }
  }, [cashingOut, phase, gameId, revealedTiles.length, queryClient, loadHistory, toast]);

  const handlePlayAgain = useCallback(() => {
    setPhase("setup");
    setGameId(null);
    setRevealedTiles([]);
    setMineTiles([]);
    setHitMine(null);
    setMultiplier(1);
    setPotentialPayout(0);
    setFinalPayout(null);
    setLastNewTile(null);
  }, []);

  // Build tile states
  const tileStates: TileState[] = Array.from({ length: TOTAL_TILES }, (_, i) => {
    if (hitMine === i) return "mine";
    if (mineTiles.includes(i) && phase === "ended") return "revealed-mine";
    if (revealedTiles.includes(i)) return "gem";
    return "hidden";
  });

  const won = phase === "ended" && (finalPayout ?? 0) > 0;
  const lost = phase === "ended" && (finalPayout ?? 0) === 0;
  const profit = won ? (finalPayout ?? 0) - betNum : -betNum;

  // Next multiplier preview — uses server-configured fee
  const nextMult = phase === "playing"
    ? calcMultiplier(mineCount, revealedTiles.length + 1, 1 - settings.feePct / 100)
    : null;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/games")}
          className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
          <ArrowLeft className="w-4 h-4" /> Games
        </button>
        <div className="flex-1" />
        {streak > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 text-xs font-bold">
            <Flame className="w-3 h-3" /> {streak}
          </div>
        )}
        <button
          onClick={() => { setShowLeaderboard(v => !v); if (!showLeaderboard) loadLeaderboard(); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trophy className="w-3.5 h-3.5" /> Board
        </button>
        <button
          onClick={() => { setShowHistory(v => !v); if (!showHistory) loadHistory(); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="w-3.5 h-3.5" /> History
        </button>
      </div>

      {/* Title */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
          <Bomb className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-black text-lg leading-tight">Mines</h1>
          <p className="text-[11px] text-muted-foreground">Find gems, avoid mines</p>
        </div>
      </div>

      {/* Leaderboard panel */}
      {showLeaderboard && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-xs font-bold flex-1">Top Wins</p>
            <div className="flex rounded-lg overflow-hidden border border-border text-[10px] font-semibold">
              <button
                onClick={() => setLbTab("today")}
                className={`px-2.5 py-1 transition-colors ${lbTab === "today" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >Today</button>
              <button
                onClick={() => setLbTab("allTime")}
                className={`px-2.5 py-1 transition-colors ${lbTab === "allTime" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >All Time</button>
            </div>
          </div>
          {(() => {
            const entries = lbTab === "today" ? (leaderboard?.today ?? []) : (leaderboard?.allTime ?? []);
            if (entries.length === 0) {
              return <p className="text-xs text-muted-foreground text-center py-4">No wins recorded {lbTab === "today" ? "today" : "yet"}</p>;
            }
            return (
              <div className="space-y-1.5">
                {entries.map(e => (
                  <div key={`${e.rank}-${e.username}`} className="flex items-center gap-2.5 py-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black ${
                      e.rank === 1 ? "bg-amber-400/20 text-amber-400" :
                      e.rank === 2 ? "bg-slate-400/20 text-slate-300" :
                      e.rank === 3 ? "bg-orange-600/20 text-orange-400" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {e.rank === 1 ? <Crown className="w-3 h-3" /> : e.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{e.username}</p>
                      <p className="text-[10px] text-muted-foreground">{e.mineCount} mine{e.mineCount !== 1 ? "s" : ""} · {e.multiplier.toFixed(2)}×</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-400">+{e.profit.toFixed(0)}</p>
                      <p className="text-[10px] text-muted-foreground">{e.payout.toFixed(0)} out</p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-bold mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-primary" /> Recent Games
          </p>
          {history.length === 0
            ? <p className="text-xs text-muted-foreground text-center py-3">No games yet</p>
            : history.map(g => <HistoryRow key={g.id} entry={g} />)
          }
        </div>
      )}

      {/* Setup panel */}
      {phase === "setup" && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
          {/* Bet */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Entry Amount</label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={bet}
                onChange={e => setBet(e.target.value)}
                placeholder="Enter amount"
                className="flex-1"
                min={settings.minBet}
                max={settings.maxBet}
              />
              <Button variant="outline" size="sm" className="text-xs shrink-0"
                onClick={() => setBet(String(Math.max(settings.minBet, Math.floor(betNum / 2))))}>½</Button>
              <Button variant="outline" size="sm" className="text-xs shrink-0"
                onClick={() => setBet(String(Math.min(settings.maxBet, betNum * 2)))}>2×</Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Min {settings.minBet} · Max {settings.maxBet} coins
            </p>
          </div>

          {/* Mine count */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
              Mines — <span className="text-foreground font-bold">{mineCount}</span>
              <span className="text-muted-foreground font-normal ml-1">
                ({TOTAL_TILES - mineCount} safe tiles)
              </span>
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {MINE_PRESETS.map(m => (
                <button
                  key={m}
                  onClick={() => setMineCount(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    mineCount === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >{m}</button>
              ))}
            </div>
            <input type="range" min={1} max={24} value={mineCount}
              onChange={e => setMineCount(Number(e.target.value))}
              className="w-full mt-2 accent-primary" />
          </div>

          {/* Multiplier preview table */}
          <div className="bg-muted/40 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Win Multipliers</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[1, 2, 3, 5, 8, 12].map(n => {
                if (n > TOTAL_TILES - mineCount) return null;
                const m = previewMultiplier(mineCount, n);
                return (
                  <div key={n} className="bg-background/60 rounded-lg p-1.5 text-center">
                    <p className="text-[10px] text-muted-foreground">{n} gem{n > 1 ? "s" : ""}</p>
                    <p className="text-xs font-bold text-emerald-400">{m.toFixed(2)}×</p>
                    {betNum > 0 && (
                      <p className="text-[9px] text-muted-foreground">{(betNum * m).toFixed(0)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Button
            className="w-full font-bold"
            style={{ background: "linear-gradient(135deg, #dc2626, #ea580c)" }}
            onClick={handleStart}
            disabled={loading || !settings.enabled || !betNum || betNum <= 0}
          >
            {loading ? "Starting…" : `Play — ${betNum > 0 ? betNum.toFixed(0) : "?"} coins entry`}
          </Button>
          {!settings.enabled && (
            <p className="text-xs text-destructive text-center">Mines is currently disabled by admin</p>
          )}
        </div>
      )}

      {/* Playing / ended */}
      {(phase === "playing" || phase === "ended") && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border border-border rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">Entry</p>
              <p className="text-sm font-black">{betNum.toFixed(0)}</p>
            </div>
            <div className={`rounded-xl p-2.5 text-center border transition-colors ${
              phase === "ended" && won ? "bg-emerald-500/10 border-emerald-500/30" :
              phase === "ended" && lost ? "bg-red-500/10 border-red-500/30" :
              "bg-card border-border"
            }`}>
              <p className="text-[10px] text-muted-foreground mb-0.5">Multiplier</p>
              <p className={`text-sm font-black ${
                phase === "ended" && won ? "text-emerald-400" :
                phase === "ended" && lost ? "text-red-400" :
                "text-amber-400"
              }`}>
                {phase === "ended" && lost ? "0×" : `${multiplier.toFixed(2)}×`}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">
                {phase === "ended" ? "Payout" : "To win"}
              </p>
              <p className={`text-sm font-black ${won ? "text-emerald-400" : lost ? "text-red-400" : ""}`}>
                {phase === "ended"
                  ? (won ? `+${(finalPayout ?? 0).toFixed(0)}` : `-${betNum.toFixed(0)}`)
                  : (revealedTiles.length > 0 ? potentialPayout.toFixed(0) : "—")
                }
              </p>
            </div>
          </div>

          {/* Next gem preview */}
          {phase === "playing" && nextMult && revealedTiles.length < TOTAL_TILES - mineCount && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <Gem className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-muted-foreground">Next gem:</span>
              <span className="font-bold text-emerald-400">{nextMult.toFixed(2)}×</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-bold">{(betNum * nextMult).toFixed(0)} coins</span>
            </div>
          )}

          {/* Mine count badge */}
          <div className="flex items-center gap-2 justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium">
              <Bomb className="w-3 h-3" /> {mineCount} mine{mineCount > 1 ? "s" : ""} hidden
            </div>
            {phase === "playing" && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-medium">
                <Gem className="w-3 h-3" /> {revealedTiles.length} found
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {tileStates.map((state, i) => (
              <Tile
                key={i}
                index={i}
                state={state}
                onClick={() => handleReveal(i)}
                disabled={revealing || phase !== "playing"}
                animIn={i === lastNewTile}
              />
            ))}
          </div>

          {/* Actions */}
          {phase === "playing" && (
            <Button
              className="w-full font-bold gap-2"
              style={{ background: "linear-gradient(135deg, #059669, #0d9488)" }}
              onClick={handleCashOut}
              disabled={cashingOut || revealedTiles.length === 0}
            >
              <DollarSign className="w-4 h-4" />
              {cashingOut
                ? "Cashing out…"
                : revealedTiles.length === 0
                  ? "Reveal a gem first"
                  : `Cash Out — ${potentialPayout.toFixed(0)} coins`
              }
            </Button>
          )}

          {phase === "ended" && (
            <div className="space-y-3">
              {/* Result banner */}
              <div className={`rounded-2xl p-4 border text-center ${
                won
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-red-500/10 border-red-500/30"
              }`}>
                <p className={`text-lg font-black mb-0.5 ${won ? "text-emerald-400" : "text-red-400"}`}>
                  {won ? "You Won! 🎉" : "Boom! 💥"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {won
                    ? `+${profit.toFixed(0)} coins profit at ${multiplier.toFixed(2)}×`
                    : `Lost ${betNum.toFixed(0)} coins — mine hit!`
                  }
                </p>
              </div>

              <Button
                className="w-full font-bold gap-2"
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
                onClick={handlePlayAgain}
              >
                <RefreshCw className="w-4 h-4" /> Play Again
              </Button>
            </div>
          )}
        </>
      )}

    </div>
  );
}
