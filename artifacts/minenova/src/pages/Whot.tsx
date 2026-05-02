import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useGetWallet, getGetWalletQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  whotApi, fetchWhotSettings,
  type WhotChallenge, type WhotGame, type WhotSettings,
} from "@/lib/whotApi";
import { Layers, Plus, Trophy, Clock, Users, RefreshCw, X, Bot, Swords, Coins } from "lucide-react";

function CoinIcon({ className }: { className?: string }) {
  return <span className={`inline-block ${className ?? "w-4 h-4"}`}>🪙</span>;
}

export default function Whot() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [showSolo, setShowSolo] = useState(false);
  const [entryFee, setEntryFee] = useState("");
  const [soloFee, setSoloFee] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingSolo, setCreatingSolo] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);

  const [waitingChallengeId, setWaitingChallengeId] = useState<number | null>(null);
  const [waitingFee, setWaitingFee] = useState<number>(0);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: wallet } = useGetWallet();

  const { data: challenges = [], isLoading, refetch } = useQuery<WhotChallenge[]>({
    queryKey: ["/api/whot/challenges"],
    queryFn: () => whotApi<WhotChallenge[]>("/whot/challenges"),
    refetchInterval: 8000,
  });

  const { data: myGameData } = useQuery<{ game: WhotGame | null }>({
    queryKey: ["/api/whot/my-game"],
    queryFn: () => whotApi<{ game: WhotGame | null }>("/whot/my-game"),
  });

  const { data: whotSettings } = useQuery<WhotSettings>({
    queryKey: ["/api/whot/settings"],
    queryFn: fetchWhotSettings,
    staleTime: 5 * 60 * 1000,
  });

  const winPct = whotSettings?.winPct ?? 90;
  const platformFeePct = whotSettings?.platformFeePct ?? 10;

  useEffect(() => {
    if (whotSettings?.soloFee && !soloFee) {
      setSoloFee(String(whotSettings.soloFee));
    }
  }, [whotSettings, soloFee]);

  const activeGame = myGameData?.game ?? null;

  // Poll waiting challenge
  useEffect(() => {
    if (!waitingChallengeId) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const poll = async () => {
      try {
        const ch = await whotApi<WhotChallenge & { gameId?: number | null }>(
          `/whot/challenges/${waitingChallengeId}`,
        );
        if (ch.status === "matched" && ch.gameId) {
          clearInterval(pollRef.current!);
          navigate(`/whot/game/${ch.gameId}`);
        } else if (ch.status === "cancelled") {
          clearInterval(pollRef.current!);
          setWaitingChallengeId(null);
          toast({ variant: "destructive", title: "Challenge was cancelled" });
        }
      } catch {
        // silently retry
      }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [waitingChallengeId, navigate, toast]);

  const handleCreate = async () => {
    const fee = Number(entryFee);
    const minFee = whotSettings?.minFee ?? 1;
    const maxFee = whotSettings?.maxFee ?? 10000;
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    if ((wallet?.withdrawableBalance ?? 0) < fee) { toast({ variant: "destructive", title: "Insufficient coin balance" }); return; }

    setCreating(true);
    try {
      const result = await whotApi<{ id: number; entryFee: number }>("/whot/challenges", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whot/challenges"] });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      setShowCreate(false);
      setEntryFee("");
      setWaitingFee(fee);
      setWaitingChallengeId(result.id);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleSoloStart = async () => {
    const fee = Number(soloFee);
    const minFee = whotSettings?.minFee ?? 1;
    const maxFee = whotSettings?.maxFee ?? 10000;
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    if ((wallet?.withdrawableBalance ?? 0) < fee) { toast({ variant: "destructive", title: "Insufficient coin balance" }); return; }

    setCreatingSolo(true);
    try {
      const result = await whotApi<{ gameId: number }>("/whot/solo", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      navigate(`/whot/game/${result.gameId}`);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCreatingSolo(false);
    }
  };

  const handleAccept = async (challengeId: number) => {
    setAccepting(challengeId);
    try {
      const result = await whotApi<{ gameId: number }>(`/whot/challenges/${challengeId}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      navigate(`/whot/game/${result.gameId}`);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
      refetch();
    } finally {
      setAccepting(null);
    }
  };

  const handleCancel = async () => {
    if (!waitingChallengeId) return;
    setCancelling(true);
    try {
      await whotApi(`/whot/challenges/${waitingChallengeId}`, { method: "DELETE" });
      setWaitingChallengeId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/whot/challenges"] });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCancelling(false);
    }
  };

  // Waiting screen
  if (waitingChallengeId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 gap-6">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Clock className="w-10 h-10 text-primary animate-pulse" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold">Waiting for Opponent</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Challenge #{waitingChallengeId} · <span className="font-semibold">{waitingFee} coins</span> entry fee
          </p>
          <p className="text-xs text-muted-foreground mt-2">Checking every 3 seconds…</p>
        </div>
        <Button variant="outline" onClick={handleCancel} disabled={cancelling} className="gap-2">
          {cancelling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          Cancel & Refund
        </Button>
      </div>
    );
  }

  const openChallenges = challenges.filter(c => c.creatorId !== user?.id);
  const myChallenges = challenges.filter(c => c.creatorId === user?.id);

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            WHOT
          </h1>
          <p className="text-xs text-muted-foreground">Nigerian card game · Wager coins</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="text-sm font-bold flex items-center gap-1">
            <CoinIcon /> {wallet?.withdrawableBalance?.toFixed(0) ?? "–"}
          </p>
        </div>
      </div>

      {/* Active game banner */}
      {activeGame && (
        <div
          className="bg-primary/10 border border-primary/30 rounded-xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => navigate(`/whot/game/${activeGame.id}`)}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Layers className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Active Game</p>
            <p className="text-xs text-muted-foreground">Game #{activeGame.id} · {activeGame.entryFee} coins</p>
          </div>
          <Button size="sm" className="shrink-0">Resume</Button>
        </div>
      )}

      {/* Play buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          className="gap-2 h-12"
          onClick={() => setShowCreate(true)}
          style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
        >
          <Swords className="w-4 h-4" />
          vs Player
        </Button>
        {(whotSettings?.soloEnabled !== false) && (
          <Button
            variant="outline"
            className="gap-2 h-12 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            onClick={() => setShowSolo(true)}
          >
            <Bot className="w-4 h-4" />
            vs Bot
          </Button>
        )}
      </div>

      {/* My open challenge */}
      {myChallenges.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Open Challenge</p>
          {myChallenges.map(ch => (
            <div key={ch.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Coins className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Waiting for opponent…</p>
                <p className="text-xs text-muted-foreground">Entry fee: {ch.entryFee} coins</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setWaitingFee(ch.entryFee); setWaitingChallengeId(ch.id); }}
              >
                View
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Open challenges */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            Open Challenges
          </p>
          <button onClick={() => refetch()} className="text-xs text-primary flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading challenges…</div>
        )}

        {!isLoading && openChallenges.length === 0 && (
          <div className="text-center py-10">
            <Layers className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No open challenges yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create one or play the bot to get started!</p>
          </div>
        )}

        {openChallenges.map(ch => {
          const pot = ch.entryFee * 2;
          const winnings = pot * (winPct / 100);
          const isAccepting = accepting === ch.id;
          return (
            <div key={ch.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
              >
                {ch.creatorUsername?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{ch.creatorUsername}</p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <CoinIcon className="text-[10px]" /> Entry: <strong className="text-foreground ml-0.5">{ch.entryFee}</strong>
                  </span>
                  <span className="text-xs text-emerald-500 flex items-center gap-0.5">
                    <Trophy className="w-3 h-3" /> Win: <strong className="ml-0.5">{winnings.toFixed(0)}</strong>
                  </span>
                </div>
              </div>
              <Button size="sm" disabled={isAccepting} onClick={() => handleAccept(ch.id)} className="shrink-0">
                {isAccepting ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Accept"}
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[10px] text-muted-foreground/50">
        {platformFeePct}% house fee · {winPct}% goes to winner
      </p>

      {/* Create challenge dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-primary" />
              Challenge a Player
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entry Fee (coins)</label>
              <Input
                type="number"
                min={whotSettings?.minFee ?? 1}
                max={whotSettings?.maxFee}
                placeholder={`e.g. ${whotSettings?.minFee ?? 100}`}
                value={entryFee}
                onChange={e => setEntryFee(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
              {entryFee && Number(entryFee) > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Pot: {Number(entryFee) * 2} coins ·{" "}
                  <span className="text-emerald-500">
                    Win {(Number(entryFee) * 2 * winPct / 100).toFixed(0)} coins
                  </span>
                </p>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Balance: <strong>{wallet?.withdrawableBalance?.toFixed(0) ?? 0}</strong> coins. Entry fee is deducted immediately. Full refund if cancelled before anyone accepts.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleCreate}
                disabled={creating || !entryFee || Number(entryFee) < (whotSettings?.minFee ?? 1)}
              >
                {creating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Solo game dialog */}
      <Dialog open={showSolo} onOpenChange={setShowSolo}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-amber-500" />
              Play vs Bot
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <p className="text-xs text-amber-600 font-medium mb-1">Solo Mode</p>
              <p className="text-xs text-muted-foreground">
                You play against an AI bot. If you win, you get{" "}
                <strong className="text-emerald-500">{winPct}% of the pot</strong>.
                If the bot wins, the platform keeps your entry fee.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entry Fee (coins)</label>
              <Input
                type="number"
                min={whotSettings?.minFee ?? 1}
                max={whotSettings?.maxFee}
                placeholder={`e.g. ${whotSettings?.soloFee ?? 100}`}
                value={soloFee}
                onChange={e => setSoloFee(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSoloStart()}
              />
              {soloFee && Number(soloFee) > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  If you win:{" "}
                  <span className="text-emerald-500 font-semibold">
                    +{(Number(soloFee) * 2 * winPct / 100).toFixed(0)} coins
                  </span>
                  {" "}· If bot wins: −{soloFee} coins
                </p>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Balance: <strong>{wallet?.withdrawableBalance?.toFixed(0) ?? 0}</strong> coins.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowSolo(false)}>Cancel</Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleSoloStart}
                disabled={creatingSolo || !soloFee || Number(soloFee) < (whotSettings?.minFee ?? 1)}
                style={{ background: "linear-gradient(135deg, #d97706, #ef4444)" }}
              >
                {creatingSolo ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                Start
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
