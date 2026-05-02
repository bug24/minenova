import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useGetWallet } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ludoApi, type LudoChallenge, type LudoGame } from "@/lib/ludoApi";
import { Dices, Plus, Trophy, Clock, Coins, Users, RefreshCw, X } from "lucide-react";

function CoinIcon({ className }: { className?: string }) {
  return <span className={`inline-block ${className ?? "w-4 h-4"}`}>🪙</span>;
}

export default function Ludo() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // UI state
  const [showCreate, setShowCreate] = useState(false);
  const [entryFee, setEntryFee] = useState("");
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);

  // Waiting state
  const [waitingChallengeId, setWaitingChallengeId] = useState<number | null>(null);
  const [waitingFee, setWaitingFee] = useState<number>(0);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Wallet
  const { data: wallet } = useGetWallet();

  // Open challenges
  const { data: challenges = [], isLoading, refetch } = useQuery<LudoChallenge[]>({
    queryKey: ["/api/ludo/challenges"],
    queryFn: () => ludoApi<LudoChallenge[]>("/ludo/challenges"),
    refetchInterval: 8000,
  });

  // Active game check
  const { data: myGameData } = useQuery<{ game: LudoGame | null }>({
    queryKey: ["/api/ludo/my-game"],
    queryFn: () => ludoApi<{ game: LudoGame | null }>("/ludo/my-game"),
  });

  const activeGame = myGameData?.game ?? null;

  // Poll for challenge match when waiting
  useEffect(() => {
    if (!waitingChallengeId) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const poll = async () => {
      try {
        const ch = await ludoApi<LudoChallenge & { gameId?: number | null }>(
          `/ludo/challenges/${waitingChallengeId}`,
        );
        if (ch.status === "matched" && ch.gameId) {
          clearInterval(pollRef.current!);
          navigate(`/ludo/game/${ch.gameId}`);
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
    if (!fee || fee < 1) { toast({ variant: "destructive", title: "Enter a valid entry fee (min 1 coin)" }); return; }
    if ((wallet?.withdrawableBalance ?? 0) < fee) { toast({ variant: "destructive", title: "Insufficient coin balance" }); return; }

    setCreating(true);
    try {
      const result = await ludoApi<{ id: number; entryFee: number }>("/ludo/challenges", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ludo/challenges"] });
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

  const handleAccept = async (challengeId: number) => {
    setAccepting(challengeId);
    try {
      const result = await ludoApi<{ gameId: number }>(`/ludo/challenges/${challengeId}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      navigate(`/ludo/game/${result.gameId}`);
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
      await ludoApi(`/ludo/challenges/${waitingChallengeId}`, { method: "DELETE" });
      setWaitingChallengeId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ludo/challenges"] });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCancelling(false);
    }
  };

  // ── Waiting screen ───────────────────────────────────────────────
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
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={cancelling}
          className="gap-2"
        >
          {cancelling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          Cancel & Refund
        </Button>
      </div>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────
  const openChallenges = challenges.filter(c => c.creatorId !== user?.id);
  const myChallenges = challenges.filter(c => c.creatorId === user?.id);

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2">
            <Dices className="w-6 h-6 text-primary" />
            Ludo
          </h1>
          <p className="text-xs text-muted-foreground">Wager coins, play 2-player Ludo</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="text-sm font-bold flex items-center gap-1">
              <CoinIcon /> {wallet?.withdrawableBalance?.toFixed(0) ?? "–"}
            </p>
          </div>
        </div>
      </div>

      {/* Active game banner */}
      {activeGame && (
        <div
          className="bg-primary/10 border border-primary/30 rounded-xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => navigate(`/ludo/game/${activeGame.id}`)}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Dices className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Active Game</p>
            <p className="text-xs text-muted-foreground">Game #{activeGame.id} · {activeGame.entryFee} coins</p>
          </div>
          <Button size="sm" className="shrink-0">Resume</Button>
        </div>
      )}

      {/* Create challenge button */}
      <Button
        className="w-full gap-2"
        onClick={() => setShowCreate(true)}
        style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
      >
        <Plus className="w-4 h-4" />
        Create Challenge
      </Button>

      {/* My open challenges */}
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
            <Dices className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No open challenges yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create one to get started!</p>
          </div>
        )}

        {openChallenges.map(ch => {
          const pot = ch.entryFee * 2;
          const winnings = pot * 0.9;
          const isAccepting = accepting === ch.id;
          return (
            <div
              key={ch.id}
              className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3"
            >
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
                    <CoinIcon className="text-[10px]" /> Entry: <strong className="text-foreground">{ch.entryFee}</strong>
                  </span>
                  <span className="text-xs text-emerald-500 flex items-center gap-0.5">
                    <Trophy className="w-3 h-3" /> Win: <strong>{winnings.toFixed(0)}</strong>
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                disabled={isAccepting}
                onClick={() => handleAccept(ch.id)}
                className="shrink-0"
              >
                {isAccepting ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Accept"}
              </Button>
            </div>
          );
        })}
      </div>

      {/* House rules note */}
      <p className="text-center text-[10px] text-muted-foreground/50">
        10% house fee on winnings · 90% goes to winner
      </p>

      {/* Create challenge dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dices className="w-5 h-5 text-primary" />
              Create a Challenge
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entry Fee (coins)</label>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 100"
                value={entryFee}
                onChange={e => setEntryFee(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
              {entryFee && Number(entryFee) > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Pot: {Number(entryFee) * 2} coins ·{" "}
                  <span className="text-emerald-500">
                    Win {(Number(entryFee) * 2 * 0.9).toFixed(0)} coins
                  </span>
                </p>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your balance: <strong>{wallet?.withdrawableBalance?.toFixed(0) ?? 0}</strong> coins. The entry fee is deducted immediately. You get a full refund if you cancel before anyone accepts.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleCreate}
                disabled={creating || !entryFee || Number(entryFee) < 1}
              >
                {creating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
