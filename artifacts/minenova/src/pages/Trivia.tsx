import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useGetWallet, getGetWalletQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  triviaApi, fetchTriviaSettings,
  type TriviaChallenge, type TriviaSettings,
} from "@/lib/triviaApi";
import {
  BookOpen, Bot, Swords, ChevronLeft, Plus, RefreshCw, X,
  Trophy, Clock, Coins, Users, TrendingUp, TrendingDown, History,
} from "lucide-react";

const FEE_PRESETS = [50, 200, 500, 1000, 5000];

interface HistoryEntry {
  id: number;
  mode: "bot" | "pvp";
  entryFee: number;
  player1Score: number;
  player2Score: number;
  winnerId: number | null;
  myScore: number;
  oppScore: number;
  profit: number;
  endedAt: string;
}

export default function Trivia() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"bot" | "pvp">("bot");
  const [entryFee, setEntryFee] = useState("");
  const [creating, setCreating] = useState(false);
  const [startingBot, setStartingBot] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);

  const [waitingChallengeId, setWaitingChallengeId] = useState<number | null>(null);
  const [waitingFee, setWaitingFee] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const { data: wallet } = useGetWallet();

  const { data: challenges = [], isLoading: challengesLoading, refetch: refetchChallenges } = useQuery<TriviaChallenge[]>({
    queryKey: ["/api/trivia/challenges"],
    queryFn: () => triviaApi<TriviaChallenge[]>("/trivia/challenges"),
    refetchInterval: 8000,
  });

  const { data: settings } = useQuery<TriviaSettings>({
    queryKey: ["/api/trivia/settings"],
    queryFn: fetchTriviaSettings,
    staleTime: 0,
  });

  const minFee = settings?.minFee ?? 50;
  const maxFee = settings?.maxFee ?? 50000;
  const feePct = settings?.feePct ?? 5;
  const enabled = settings?.enabled ?? true;

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await triviaApi<HistoryEntry[]>("/trivia/history");
      setHistory(data);
    } catch { /* ignore */ } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  // Poll for PvP challenge acceptance
  useEffect(() => {
    if (!waitingChallengeId) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const poll = async () => {
      try {
        const ch = await triviaApi<TriviaChallenge & { gameId?: number | null }>(
          `/trivia/challenges/${waitingChallengeId}`,
        );
        if (ch.status === "matched" && ch.gameId) {
          clearInterval(pollRef.current!);
          navigate(`/trivia/game/${ch.gameId}`);
        } else if (ch.status === "cancelled") {
          clearInterval(pollRef.current!);
          setWaitingChallengeId(null);
          toast({ variant: "destructive", title: "Challenge was cancelled" });
        }
      } catch { /* retry */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [waitingChallengeId, navigate, toast]);

  const handleStartBot = async () => {
    const fee = Number(entryFee);
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    setStartingBot(true);
    try {
      const data = await triviaApi<{ gameId: number }>("/trivia/solo", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      navigate(`/trivia/game/${data.gameId}`);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setStartingBot(false);
    }
  };

  const handleCreateChallenge = async () => {
    const fee = Number(entryFee);
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    setCreating(true);
    try {
      const data = await triviaApi<{ id: number; entryFee: number }>("/trivia/challenges", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      setWaitingChallengeId(data.id);
      setWaitingFee(fee);
      refetchChallenges();
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleAccept = async (challengeId: number) => {
    setAccepting(challengeId);
    try {
      const data = await triviaApi<{ gameId: number }>(`/trivia/challenges/${challengeId}/accept`, {
        method: "POST",
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      navigate(`/trivia/game/${data.gameId}`);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
      refetchChallenges();
    } finally {
      setAccepting(null);
    }
  };

  const handleCancel = async () => {
    if (!waitingChallengeId) return;
    setCancelling(true);
    try {
      await triviaApi(`/trivia/challenges/${waitingChallengeId}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      setWaitingChallengeId(null);
      refetchChallenges();
      toast({ title: "Challenge cancelled — coins refunded" });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCancelling(false);
    }
  };

  const pot = Number(entryFee) * 2;
  const potAfterFee = pot - pot * feePct / 100;

  // Waiting screen
  if (waitingChallengeId) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => setWaitingChallengeId(null)} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center mx-auto">
            <Users className="w-7 h-7 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-black text-lg">Waiting for opponent…</h2>
            <p className="text-xs text-muted-foreground mt-1">Entry fee: <span className="font-bold text-foreground">{waitingFee.toLocaleString()} coins</span></p>
          </div>
          <div className="flex justify-center">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            <X className="w-3.5 h-3.5 mr-1.5" />
            {cancelling ? "Cancelling…" : "Cancel & Refund"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/games")} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
          <ChevronLeft className="w-4 h-4" /> Games
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="w-3.5 h-3.5" /> History
        </button>
      </div>

      {/* Title */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shrink-0">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-black text-lg leading-tight">Trivia Quiz</h1>
          <p className="text-[11px] text-muted-foreground">Answer 10 crypto questions to win</p>
        </div>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-bold mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-primary" /> Recent Games
          </p>
          {loadingHistory ? (
            <p className="text-xs text-muted-foreground text-center py-3">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No games yet</p>
          ) : (
            history.map(g => {
              const won = g.profit > 0;
              const tied = g.profit === 0 || (g.winnerId === null);
              return (
                <div key={g.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${won ? "bg-emerald-500/20" : tied ? "bg-yellow-500/20" : "bg-red-500/20"}`}>
                    {won ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">
                      {g.mode === "bot" ? "vs Bot" : "vs Player"} · {g.entryFee.toLocaleString()} coins
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {g.myScore}/10 correct
                    </p>
                  </div>
                  <span className={`text-xs font-bold shrink-0 ${won ? "text-emerald-400" : tied ? "text-yellow-400" : "text-red-400"}`}>
                    {g.profit > 0 ? "+" : ""}{g.profit.toFixed(0)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode("bot")}
          className={`flex flex-col items-center gap-1.5 py-3 px-4 rounded-xl border transition-all ${mode === "bot" ? "bg-indigo-500/15 border-indigo-500/50 text-indigo-400" : "bg-card border-border text-muted-foreground hover:border-border/80"}`}
        >
          <Bot className="w-5 h-5" />
          <span className="text-xs font-bold">vs Bot</span>
          <span className="text-[10px]">Play solo</span>
        </button>
        <button
          onClick={() => setMode("pvp")}
          className={`flex flex-col items-center gap-1.5 py-3 px-4 rounded-xl border transition-all ${mode === "pvp" ? "bg-indigo-500/15 border-indigo-500/50 text-indigo-400" : "bg-card border-border text-muted-foreground hover:border-border/80"}`}
        >
          <Swords className="w-5 h-5" />
          <span className="text-xs font-bold">vs Player</span>
          <span className="text-[10px]">PvP match</span>
        </button>
      </div>

      {/* Entry fee */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <label className="text-xs font-semibold text-muted-foreground block">Entry Fee (coins)</label>
        <Input
          type="number"
          value={entryFee}
          onChange={e => setEntryFee(e.target.value)}
          placeholder={`Min ${minFee.toLocaleString()}`}
          className="text-sm"
        />
        <div className="flex gap-1.5 flex-wrap">
          {FEE_PRESETS.filter(p => p >= minFee && p <= maxFee).map(p => (
            <button
              key={p}
              onClick={() => setEntryFee(String(p))}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${entryFee === String(p) ? "bg-indigo-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {p.toLocaleString()}
            </button>
          ))}
        </div>
        {Number(entryFee) > 0 && (
          <div className="bg-muted/40 rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total pot</span>
              <span className="font-semibold">{pot.toLocaleString()} coins</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Platform fee ({feePct}%)</span>
              <span className="text-muted-foreground">-{(pot * feePct / 100).toFixed(0)} coins</span>
            </div>
            <div className="flex justify-between text-xs border-t border-border/50 pt-1.5">
              <span className="font-semibold">Winner gets</span>
              <span className="font-black text-emerald-400">{potAfterFee.toFixed(0)} coins</span>
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">Min {minFee.toLocaleString()} · Max {maxFee.toLocaleString()} coins</p>
      </div>

      {/* Action button */}
      {mode === "bot" ? (
        <Button
          className="w-full font-bold"
          style={{ background: "linear-gradient(135deg, #6366f1, #3b82f6)" }}
          onClick={handleStartBot}
          disabled={startingBot || !enabled || !Number(entryFee)}
        >
          <Bot className="w-4 h-4 mr-2" />
          {startingBot ? "Starting…" : "Play vs Bot"}
        </Button>
      ) : (
        <Button
          className="w-full font-bold"
          style={{ background: "linear-gradient(135deg, #6366f1, #3b82f6)" }}
          onClick={handleCreateChallenge}
          disabled={creating || !enabled || !Number(entryFee)}
        >
          <Plus className="w-4 h-4 mr-2" />
          {creating ? "Creating…" : "Create Challenge"}
        </Button>
      )}

      {!enabled && (
        <p className="text-xs text-destructive text-center">Trivia is currently disabled by admin</p>
      )}

      {/* Open challenges (PvP mode) */}
      {mode === "pvp" && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-400" /> Open Challenges
            </p>
            <button onClick={() => refetchChallenges()} className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {challengesLoading ? (
            <p className="text-xs text-muted-foreground text-center py-3">Loading…</p>
          ) : challenges.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No open challenges. Create one above!</p>
          ) : (
            <div className="space-y-2">
              {challenges.map(ch => (
                <div key={ch.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{ch.creatorUsername}</p>
                    <p className="text-[10px] text-muted-foreground">{ch.entryFee.toLocaleString()} coins entry</p>
                  </div>
                  {ch.creatorId === user?.id ? (
                    <span className="text-[10px] text-muted-foreground font-medium bg-muted px-2 py-0.5 rounded-full">Yours</span>
                  ) : (
                    <Button
                      size="sm"
                      className="text-xs h-7 px-3"
                      style={{ background: "linear-gradient(135deg, #6366f1, #3b82f6)" }}
                      onClick={() => handleAccept(ch.id)}
                      disabled={accepting === ch.id}
                    >
                      {accepting === ch.id ? "…" : "Accept"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* How to play */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-xs font-bold mb-3 flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-indigo-400" /> How to Play
        </p>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex gap-2.5 items-start">
            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <span>Choose your mode (vs Bot or vs Player) and set an entry fee</span>
          </div>
          <div className="flex gap-2.5 items-start">
            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <span>Answer 10 crypto questions with 15 seconds per question</span>
          </div>
          <div className="flex gap-2.5 items-start">
            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <span>The player with the most correct answers wins the pot (minus platform fee)</span>
          </div>
          <div className="flex gap-2.5 items-start">
            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
            <span>Ties result in both players receiving a partial refund</span>
          </div>
        </div>
      </div>
    </div>
  );
}
