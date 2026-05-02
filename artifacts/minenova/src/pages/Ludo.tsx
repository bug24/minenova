import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useGetWallet, getGetWalletQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ludoApi, fetchLudoSettings, type LudoChallenge, type LudoGame, type LudoSettings } from "@/lib/ludoApi";
import { Dices, Plus, Trophy, Clock, Coins, Users, RefreshCw, X, Bot, Swords, ChevronLeft, ChevronDown, BookOpen } from "lucide-react";

function CoinIcon({ className }: { className?: string }) {
  return <span className={`inline-block ${className ?? "w-4 h-4"}`}>🪙</span>;
}

export default function Ludo() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [showSolo, setShowSolo] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
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

  const { data: challenges = [], isLoading, refetch } = useQuery<LudoChallenge[]>({
    queryKey: ["/api/ludo/challenges"],
    queryFn: () => ludoApi<LudoChallenge[]>("/ludo/challenges"),
    refetchInterval: 8000,
  });

  const { data: myGameData } = useQuery<{ game: LudoGame | null }>({
    queryKey: ["/api/ludo/my-game"],
    queryFn: () => ludoApi<{ game: LudoGame | null }>("/ludo/my-game"),
  });

  const { data: ludoSettings } = useQuery<LudoSettings>({
    queryKey: ["/api/ludo/settings"],
    queryFn: fetchLudoSettings,
    staleTime: 5 * 60 * 1000,
  });

  const winPct = ludoSettings?.winPct ?? 90;
  const platformFeePct = ludoSettings?.platformFeePct ?? 10;

  // Pre-fill solo fee with the default from settings
  useEffect(() => {
    if (ludoSettings?.soloFee && !soloFee) {
      setSoloFee(String(ludoSettings.soloFee));
    }
  }, [ludoSettings, soloFee]);

  const activeGame = myGameData?.game ?? null;

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
    const minFee = ludoSettings?.minFee ?? 1;
    const maxFee = ludoSettings?.maxFee ?? 10000;
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    if ((wallet?.withdrawableBalance ?? 0) < fee) { toast({ variant: "destructive", title: "Insufficient coin balance" }); return; }

    setCreating(true);
    try {
      const result = await ludoApi<{ id: number; entryFee: number }>("/ludo/challenges", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ludo/challenges"] });
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
    const minFee = ludoSettings?.minFee ?? 1;
    const maxFee = ludoSettings?.maxFee ?? 10000;
    if (!fee || fee < minFee) { toast({ variant: "destructive", title: `Min entry fee is ${minFee} coins` }); return; }
    if (fee > maxFee) { toast({ variant: "destructive", title: `Max entry fee is ${maxFee} coins` }); return; }
    if ((wallet?.withdrawableBalance ?? 0) < fee) { toast({ variant: "destructive", title: "Insufficient coin balance" }); return; }

    setCreatingSolo(true);
    try {
      const result = await ludoApi<{ gameId: number }>("/ludo/solo", {
        method: "POST",
        body: JSON.stringify({ entryFee: fee }),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      navigate(`/ludo/game/${result.gameId}`);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setCreatingSolo(false);
    }
  };

  const handleAccept = async (challengeId: number) => {
    setAccepting(challengeId);
    try {
      const result = await ludoApi<{ gameId: number }>(`/ludo/challenges/${challengeId}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
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
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
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
          <button
            onClick={() => navigate("/games")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1 -ml-0.5"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Games
          </button>
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

      {/* PvP disabled banner */}
      {ludoSettings && ludoSettings.pvpEnabled === false && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <Swords className="w-4 h-4 shrink-0" />
          PvP is currently disabled. You can still play against the bot while it's off.
        </div>
      )}

      {/* Play buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          className="gap-2 h-12"
          onClick={() => setShowCreate(true)}
          disabled={ludoSettings?.pvpEnabled === false}
          style={ludoSettings?.pvpEnabled === false ? undefined : { background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
        >
          <Swords className="w-4 h-4" />
          vs Player
        </Button>
        {(ludoSettings?.soloEnabled !== false) && (
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

      {/* How to Play */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-muted/40 transition-colors"
          onClick={() => setShowHowTo(v => !v)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="w-4 h-4 text-primary" />
            How to Play Ludo
          </span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showHowTo ? "rotate-180" : ""}`} />
        </button>

        {showHowTo && (
          <div className="px-4 pb-4 space-y-4 border-t border-card-border">

            {/* Game Rules */}
            <div className="pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">Game Rules</p>
              <ol className="space-y-2">
                {[
                  "Each player controls 4 tokens that start locked in their home base.",
                  "Roll the dice on your turn. Roll a 6 to unlock and place a token on the board.",
                  "Move your tokens clockwise around the board according to each dice roll.",
                  "Land exactly on an opponent's token to send it back to their base.",
                  "Roll a 6 at any point to get a bonus roll.",
                  "Race all 4 of your tokens to the centre finish square to win!",
                ].map((rule, i) => (
                  <li key={i} className="flex gap-2.5 text-xs text-muted-foreground leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center flex-shrink-0 text-[10px] mt-0.5">
                      {i + 1}
                    </span>
                    {rule}
                  </li>
                ))}
              </ol>
            </div>

            {/* Coins & Winnings */}
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" />
                Coins &amp; Winning Procedure
              </p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Your entry fee</span>
                  <span className="font-semibold text-foreground">X coins</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Opponent's entry fee</span>
                  <span className="font-semibold text-foreground">+ X coins</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between text-muted-foreground">
                  <span>Total pot</span>
                  <span className="font-semibold text-foreground">2X coins</span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Winner receives ({winPct}%)</span>
                  <span>≈ {winPct * 2 / 100}× your fee</span>
                </div>
                <div className="flex justify-between text-muted-foreground/60 text-[11px]">
                  <span>Platform fee ({platformFeePct}%)</span>
                  <span>kept by house</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed pt-0.5">
                Example: Enter <strong>100 coins</strong> → Pot = 200 coins → You win{" "}
                <strong className="text-emerald-500">{(200 * winPct / 100).toFixed(0)} coins</strong> if you beat your opponent.
              </p>
            </div>

          </div>
        )}
      </div>

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
            <p className="text-xs text-muted-foreground/60 mt-1">Create one or challenge the bot to get started!</p>
          </div>
        )}

        {openChallenges.map(ch => {
          const pot = ch.entryFee * 2;
          const winnings = pot * (winPct / 100);
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
                min={ludoSettings?.minFee ?? 1}
                max={ludoSettings?.maxFee}
                placeholder={`e.g. ${ludoSettings?.minFee ?? 100}`}
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
                disabled={creating || !entryFee || Number(entryFee) < (ludoSettings?.minFee ?? 1)}
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
                min={ludoSettings?.minFee ?? 1}
                max={ludoSettings?.maxFee}
                placeholder={`e.g. ${ludoSettings?.soloFee ?? 100}`}
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
                Your balance: <strong>{wallet?.withdrawableBalance?.toFixed(0) ?? 0}</strong> coins.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowSolo(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleSoloStart}
                disabled={creatingSolo || !soloFee || Number(soloFee) < (ludoSettings?.minFee ?? 1)}
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
