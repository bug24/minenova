import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import WhotCard from "@/components/whot/WhotCard";
import {
  whotApi, fetchWhotSettings, getWhotSSEUrl, isCardPlayable, topCard, effectiveSuit, sendWhotSignal,
  SUIT_SYMBOLS, SUIT_COLORS,
  type WhotGame, type WhotGameState, type WhotSettings, type WhotCard as WhotCardType, type WhotSuit,
} from "@/lib/whotApi";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { useAppSettings } from "@/hooks/useAppSettings";
import VoiceChatButton from "@/components/VoiceChatButton";
import {
  unlockAudio, playCardSelect, playCardPlay, playCardDraw,
  playTap, playWin, playBuzzer,
} from "@/lib/sounds";
import { burstConfetti } from "@/lib/confetti";
import { ArrowLeft, Trophy, Skull, RefreshCw, Flag, Bot, Timer, Layers } from "lucide-react";

const SUITS: WhotSuit[] = ["Circle", "Triangle", "Cross", "Square", "Star"];

function useGameId() {
  const params = useParams<{ id: string }>();
  return Number(params.id);
}

// ---------------------------------------------------------------------------
// Suit picker modal
// ---------------------------------------------------------------------------
// Inline SVG suit shape for the suit picker — matches card artwork
function SuitSvgIcon({ suit }: { suit: WhotSuit }) {
  const ink = "#7a1212";
  const star = (cx: number, cy: number, or_: number, ir: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? or_ : ir;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  const cross = (cx: number, cy: number, aw: number, ar: number) => {
    const f = (n: number) => n.toFixed(1);
    return [
      `M${f(cx - aw)},${f(cy - ar)}`, `h${aw * 2}`, `v${ar - aw}`, `h${ar - aw}`,
      `v${aw * 2}`, `h${-(ar - aw)}`, `v${ar - aw}`, `h${-aw * 2}`,
      `v${-(ar - aw)}`, `h${-(ar - aw)}`, `v${-aw * 2}`, `h${ar - aw}`, "z",
    ].join(" ");
  };
  return (
    <svg viewBox="0 0 40 40" width={32} height={32}>
      {suit === "Triangle" && <polygon points="20,4 37,34 3,34" fill={ink} />}
      {suit === "Circle"   && <circle cx="20" cy="20" r="16" fill={ink} />}
      {suit === "Cross"    && <path d={cross(20, 20, 6.5, 16)} fill={ink} />}
      {suit === "Square"   && <rect x="3" y="3" width="34" height="34" fill={ink} />}
      {suit === "Star"     && <polygon points={star(20, 20, 17, 7)} fill={ink} />}
    </svg>
  );
}

function SuitPicker({ onPick }: { onPick: (suit: WhotSuit) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
      <div className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-xs text-center space-y-4">
        <h3 className="text-base font-bold">Call a Suit</h3>
        <p className="text-xs text-muted-foreground">You played WHOT — choose the next suit</p>
        <div className="grid grid-cols-5 gap-2">
          {SUITS.map(s => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border-2 border-[#7a1212]/30 bg-[#faf7f0] transition-all active:scale-95 hover:border-[#7a1212] hover:shadow-md"
            >
              <SuitSvgIcon suit={s} />
              <span className="text-[9px] font-semibold text-[#7a1212]">{s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result modal
// ---------------------------------------------------------------------------
interface ResultModalProps {
  game: WhotGame;
  myUserId: number;
  isSolo: boolean;
  settings: WhotSettings | null;
  onGoLobby: () => void;
}

function ResultModal({ game, myUserId, isSolo, settings, onGoLobby }: ResultModalProps) {
  const won = game.winnerId === myUserId;
  const feePct = settings?.platformFeePct ?? 10;
  const pot = game.entryFee * 2;
  const fee = pot * (feePct / 100);
  const winnings = pot - fee;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
      <div className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${won ? "bg-amber-400/20" : "bg-destructive/20"}`}>
          {won ? <Trophy className="w-8 h-8 text-amber-400" /> : <Skull className="w-8 h-8 text-destructive" />}
        </div>
        <div>
          <h2 className="text-2xl font-black">
            {won ? "You Won! 🎉" : isSolo ? "Bot Won" : "You Lost"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {won ? "Coins credited to your account." : "Better luck next time!"}
          </p>
        </div>
        {won ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Pot</span>
              <span className="font-semibold">+{pot.toFixed(0)} coins</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">House fee ({feePct}%)</span>
              <span className="text-destructive">−{fee.toFixed(0)} coins</span>
            </div>
            <div className="border-t border-emerald-500/20 pt-1.5 flex justify-between text-sm font-bold">
              <span>You received</span>
              <span className="text-emerald-500">+{winnings.toFixed(0)} coins</span>
            </div>
          </div>
        ) : (
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Entry fee paid</span>
              <span className="font-semibold text-destructive">−{game.entryFee.toFixed(0)} coins</span>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onGoLobby}>Lobby</Button>
          <Button
            className="flex-1 gap-1"
            onClick={onGoLobby}
            style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Play Again
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discard pile display — top card re-mounts (via key) each time pile grows,
// triggering the card-land entrance animation.
// ---------------------------------------------------------------------------
function DiscardDisplay({ state }: { state: WhotGameState }) {
  const top = topCard(state);
  const eSuit = effectiveSuit(state);
  const suitColor = SUIT_COLORS[eSuit] ?? "#888";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Discard</p>
      <div className="relative">
        {state.discardPile.length > 1 && (
          <div className="absolute top-0.5 left-0.5 opacity-35 pointer-events-none">
            <WhotCard card={state.discardPile[state.discardPile.length - 2]} size="lg" />
          </div>
        )}
        {/* key re-mounts the component whenever pile grows → triggers card-land */}
        <WhotCard
          key={state.discardPile.length}
          card={top}
          size="lg"
          animate="land"
        />
      </div>
      {top.suit === "WHOT" && state.calledSuit && (
        <p className="text-[10px] font-bold" style={{ color: suitColor }}>
          Called: {SUIT_SYMBOLS[state.calledSuit]} {state.calledSuit}
        </p>
      )}
      {state.pendingPickCount > 0 && (
        <span className="text-[10px] font-bold text-red-400 bg-red-400/10 border border-red-400/30 rounded px-1.5 py-0.5">
          Pick +{state.pendingPickCount}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opponent hand (face-down)
// ---------------------------------------------------------------------------
function OpponentHand({ count, isBot }: { count: number; isBot: boolean }) {
  const shown = Math.min(count, 10);
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[10px] text-muted-foreground">
        {isBot ? "Bot" : "Opponent"} — {count} card{count !== 1 ? "s" : ""}
      </p>
      <div className="flex gap-0.5 flex-wrap justify-center max-w-[260px]">
        {Array.from({ length: shown }).map((_, i) => (
          <WhotCard key={i} card={{ suit: "WHOT", value: 0 }} size="sm" faceDown />
        ))}
        {count > shown && (
          <span className="text-xs text-muted-foreground self-end ml-1">+{count - shown}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------
export default function WhotGame() {
  const gameId = useGameId();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [game, setGame] = useState<WhotGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null);
  const [pendingSuit, setPendingSuit] = useState(false);
  const [opponentUsername, setOpponentUsername] = useState("Opponent");
  // Tracks which card indices in myHand should animate as newly-drawn
  const [drawnIndices, setDrawnIndices] = useState<Set<number>>(new Set());
  const prevHandSizeRef = useRef<number>(0);

  const myUserId = user?.id ?? 0;
  const gameState = game?.gameState ?? null;
  const myIndex: 0 | 1 = game ? (game.player0Id === myUserId ? 0 : 1) : 0;
  const oppIndex: 0 | 1 = myIndex === 0 ? 1 : 0;

  const isMyTurn = gameState?.currentTurn === myIndex;
  const myHand = gameState?.players[myIndex].hand ?? [];
  const oppHandCount = gameState?.players[oppIndex].hand.length ?? 0;

  const isBotOpponent = opponentUsername === "__system__";

  const opponentUserId = game ? (myIndex === 0 ? game.player1Id : game.player0Id) : 0;
  const isVoiceInitiator = myUserId < opponentUserId;

  const sendSignal = useCallback(async (type: string, payload: unknown) => {
    try { await sendWhotSignal(gameId, type, payload); } catch { /* non-fatal */ }
  }, [gameId]);

  const { voiceChatEnabled } = useAppSettings();

  const voiceChat = useVoiceChat({
    isInitiator: isVoiceInitiator,
    sendSignal,
    enabled: !isBotOpponent && game?.status === "active" && voiceChatEnabled,
  });

  const handleRemoteSignalRef = useRef(voiceChat.handleRemoteSignal);
  handleRemoteSignalRef.current = voiceChat.handleRemoteSignal;

  useEffect(() => {
    if (game?.status === "completed") voiceChat.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status]);

  // Detect newly added cards in myHand and mark them for draw animation
  useEffect(() => {
    const prev = prevHandSizeRef.current;
    const curr = myHand.length;
    prevHandSizeRef.current = curr;
    if (curr <= prev) return;
    const newIndices = new Set<number>();
    for (let i = prev; i < curr; i++) newIndices.add(i);
    setDrawnIndices(newIndices);
    const tid = setTimeout(() => setDrawnIndices(new Set()), 450);
    return () => clearTimeout(tid);
  }, [myHand.length]);

  const playableIndices = gameState && isMyTurn
    ? myHand.map((_, i) => isCardPlayable(myHand[i], gameState) ? i : -1).filter(i => i >= 0)
    : [];
  const hasPlayable = playableIndices.length > 0;

  const { data: whotSettings = null } = useQuery<WhotSettings>({
    queryKey: ["/api/whot/settings"],
    queryFn: fetchWhotSettings,
    staleTime: 0,
  });

  // Load initial game
  useEffect(() => {
    setLoading(true);
    whotApi<WhotGame & { player0Username?: string; player1Username?: string }>(`/whot/games/${gameId}`)
      .then(g => {
        setGame(g);
        if (g.status === "completed") setShowResult(true);
        const myIdx = g.player0Id === myUserId ? 0 : 1;
        const oppUn = myIdx === 0
          ? (g.player1Username ?? "Opponent")
          : (g.player0Username ?? "Opponent");
        setOpponentUsername(oppUn);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load game" }))
      .finally(() => setLoading(false));
  }, [gameId, myUserId, toast]);

  // SSE
  useEffect(() => {
    if (!gameId) return;
    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      es = new EventSource(getWhotSSEUrl(gameId));
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type: string;
            state?: WhotGameState;
            signalType?: string;
            from?: number;
            payload?: unknown;
          };
          retryDelay = 1000;

          if (event.type === "signal" && event.from !== myUserId && event.signalType) {
            handleRemoteSignalRef.current(event.signalType, event.payload);
            return;
          }

          if (event.state) {
            // Opponent's move arrives via SSE — play card sound
            if (event.type === "played" || event.type === "drew") {
              playCardPlay();
            }
            setGame(g => g
              ? { ...g, gameState: event.state!, status: event.state!.status, winnerId: event.state!.winnerId }
              : g
            );
            setSelectedCardIdx(null);
            if (event.state.status === "completed") {
              if (event.state.winnerId === myUserId) { playWin(); burstConfetti(); } else playBuzzer();
              setShowResult(true);
              queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            }
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        es?.close();
        if (!unmounted) {
          retryTimeout = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30000);
            connect();
          }, retryDelay);
        }
      };
    };

    connect();
    return () => {
      unmounted = true;
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [gameId, myUserId, queryClient]);

  const handleCardClick = (idx: number) => {
    if (!isMyTurn || !gameState) return;
    if (!isCardPlayable(myHand[idx], gameState)) return;
    unlockAudio();
    playCardSelect();
    setSelectedCardIdx(prev => prev === idx ? null : idx);
  };

  const handlePlayCard = useCallback(async (calledSuit?: WhotSuit) => {
    if (selectedCardIdx === null || !gameState) return;
    const card = myHand[selectedCardIdx];

    if (card.suit === "WHOT" && !calledSuit) {
      playTap();
      setPendingSuit(true);
      return;
    }

    playCardPlay();
    setPlaying(true);
    try {
      const result = await whotApi<{ state: WhotGameState }>(`/whot/games/${gameId}/play`, {
        method: "POST",
        body: JSON.stringify({ cardIndex: selectedCardIdx, calledSuit: calledSuit ?? null }),
      });
      setGame(g => g ? { ...g, gameState: result.state, status: result.state.status, winnerId: result.state.winnerId } : g);
      setSelectedCardIdx(null);
      setPendingSuit(false);
      if (result.state.status === "completed") {
        if (result.state.winnerId === myUserId) { playWin(); burstConfetti(); } else playBuzzer();
        setShowResult(true);
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      }
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setPlaying(false);
    }
  }, [selectedCardIdx, gameState, myHand, gameId, toast, queryClient]);

  const handleSuitPicked = (suit: WhotSuit) => {
    setPendingSuit(false);
    handlePlayCard(suit);
  };

  const handleDraw = useCallback(async () => {
    if (!isMyTurn || drawing) return;
    playCardDraw();
    setDrawing(true);
    try {
      const result = await whotApi<{ state: WhotGameState }>(`/whot/games/${gameId}/draw`, { method: "POST" });
      setGame(g => g ? { ...g, gameState: result.state, status: result.state.status, winnerId: result.state.winnerId } : g);
      setSelectedCardIdx(null);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setDrawing(false);
    }
  }, [isMyTurn, drawing, gameId, toast]);

  const handleForfeit = useCallback(async () => {
    setForfeiting(true);
    try {
      await whotApi(`/whot/games/${gameId}/forfeit`, { method: "POST" });
      setShowForfeitConfirm(false);
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setForfeiting(false);
    }
  }, [gameId, queryClient, toast]);

  const handleClaimTimeout = useCallback(async () => {
    try {
      await whotApi(`/whot/games/${gameId}/claim-timeout`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    }
  }, [gameId, queryClient, toast]);

  const canClaimTimeout = (() => {
    if (!gameState || isMyTurn || !gameState.lastMoveAt) return false;
    return Date.now() - new Date(gameState.lastMoveAt).getTime() > 3 * 60 * 1000;
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading game…</p>
        </div>
      </div>
    );
  }

  if (!game || !gameState) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Game not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/whot")}>Back to Lobby</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 pb-24 pt-2">
      {/* Suit picker */}
      {pendingSuit && <SuitPicker onPick={handleSuitPicked} />}

      {/* Result modal */}
      {showResult && (
        <ResultModal
          game={game}
          myUserId={myUserId}
          isSolo={isBotOpponent}
          settings={whotSettings}
          onGoLobby={() => navigate("/whot")}
        />
      )}

      {/* Forfeit confirm */}
      {showForfeitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
          <div className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-xs text-center space-y-4">
            <Flag className="w-10 h-10 text-destructive mx-auto" />
            <h3 className="text-base font-bold">Forfeit Game?</h3>
            <p className="text-xs text-muted-foreground">Your opponent wins the prize pot.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForfeitConfirm(false)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={handleForfeit} disabled={forfeiting}>
                {forfeiting ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Forfeit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/whot")} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
          <ArrowLeft className="w-4 h-4" />
          Lobby
        </button>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Layers className="w-3 h-3" />
          Game #{game.id} · {game.entryFee}🪙
          {isBotOpponent && <span className="text-amber-500 flex items-center gap-0.5"> · <Bot className="w-3 h-3" /> Solo</span>}
        </span>
        <button onClick={() => setShowForfeitConfirm(true)} className="flex items-center gap-1 text-xs text-destructive active:opacity-60">
          <Flag className="w-3.5 h-3.5" />
          Forfeit
        </button>
      </div>

      {/* Opponent section */}
      <div className={`rounded-xl border p-3 transition-all ${!isMyTurn ? "border-amber-400/40 bg-amber-400/5" : "border-card-border bg-card"}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Avatar with animated speaking ring */}
            <div className="relative flex-shrink-0">
              {voiceChat.isRemoteSpeaking && (
                <>
                  <div className="absolute inset-[-4px] rounded-full border-2 border-emerald-400 animate-ping opacity-70 pointer-events-none" />
                  <div className="absolute inset-[-3px] rounded-full border-2 border-emerald-400/50 pointer-events-none" />
                </>
              )}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white transition-shadow ${voiceChat.isRemoteSpeaking ? "shadow-[0_0_8px_rgba(52,211,153,0.7)]" : ""}`}
                style={{ background: isBotOpponent ? "#d97706" : "linear-gradient(135deg, #7c3aed, #ec4899)" }}
              >
                {isBotOpponent ? <Bot className="w-3.5 h-3.5" /> : opponentUsername[0]?.toUpperCase()}
              </div>
            </div>
            <span className="text-xs font-semibold">{isBotOpponent ? "Bot (AI)" : opponentUsername}</span>
          </div>
          {!isMyTurn && (
            <span className="text-[10px] text-amber-500 font-bold animate-pulse">
              {isBotOpponent ? "Bot thinking…" : "Their turn"}
            </span>
          )}
        </div>
        <OpponentHand count={oppHandCount} isBot={isBotOpponent} />
      </div>

      {/* Discard pile + deck row */}
      <div className="flex items-center justify-around py-2">
        <DiscardDisplay state={gameState} />

        {/* Draw pile */}
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Deck ({gameState.deck.length})</p>
          <div
            onClick={isMyTurn && !hasPlayable && !drawing ? handleDraw : undefined}
            className={`w-16 h-24 rounded-lg border-2 border-white/10 flex flex-col items-center justify-center select-none transition-all ${isMyTurn && !hasPlayable ? "cursor-pointer active:scale-95 hover:brightness-125" : "cursor-default"}`}
            style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)" }}
          >
            <span className="text-white/40 font-bold text-xl">W</span>
            <span className="text-[9px] text-white/30">{gameState.deck.length} left</span>
          </div>
          {isMyTurn && (
            <Button size="sm" variant="outline" className="text-xs h-7 px-3" onClick={handleDraw} disabled={drawing}>
              {drawing ? <RefreshCw className="w-3 h-3 animate-spin" /> : gameState.pendingPickCount > 0 ? `Pick +${gameState.pendingPickCount}` : "Draw"}
            </Button>
          )}
        </div>
      </div>

      {/* Turn status bar */}
      <div className="bg-card border border-card-border rounded-xl px-4 py-2.5 text-center min-h-[48px] flex items-center justify-center">
        {game.status === "completed" ? (
          <span className="text-sm font-semibold text-primary">Game Over</span>
        ) : isMyTurn ? (
          selectedCardIdx !== null ? (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <span className="text-xs font-semibold text-amber-500">Card selected</span>
              <Button
                size="sm"
                className="h-7 px-4 text-xs gap-1"
                onClick={() => handlePlayCard()}
                disabled={playing}
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
              >
                {playing ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Play Card"}
              </Button>
              <button onClick={() => setSelectedCardIdx(null)} className="text-[10px] text-muted-foreground underline">
                deselect
              </button>
            </div>
          ) : gameState.pendingPickCount > 0 ? (
            <p className="text-xs font-semibold text-red-400">
              {hasPlayable ? `Chain with +2 or +5, or draw +${gameState.pendingPickCount}` : `Must draw +${gameState.pendingPickCount} — tap Draw`}
            </p>
          ) : hasPlayable ? (
            <p className="text-xs font-semibold text-emerald-400 animate-pulse">Your turn — tap a glowing card to play</p>
          ) : (
            <p className="text-xs text-muted-foreground">No playable cards — tap Draw</p>
          )
        ) : (
          <div className="space-y-0.5 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              {isBotOpponent
                ? <><Bot className="w-3 h-3 text-amber-500" /><span className="text-amber-500">Bot is thinking…</span></>
                : <><RefreshCw className="w-3 h-3 animate-spin" />Waiting for opponent…</>
              }
            </p>
            {!isBotOpponent && canClaimTimeout && (
              <button onClick={handleClaimTimeout} className="text-xs text-amber-500 flex items-center gap-1 mx-auto">
                <Timer className="w-3 h-3" />
                Claim timeout win
              </button>
            )}
          </div>
        )}
      </div>

      {/* Voice chat — right below turn status bar */}
      {!isBotOpponent && game.status === "active" && voiceChatEnabled && (
        <VoiceChatButton
          inline
          status={voiceChat.status}
          isMuted={voiceChat.isMuted}
          isRemoteSpeaking={voiceChat.isRemoteSpeaking}
          onStart={voiceChat.start}
          onStop={voiceChat.stop}
          onToggleMute={voiceChat.toggleMute}
        />
      )}

      {/* My hand */}
      <div className={`rounded-xl border p-3 transition-all ${isMyTurn ? "border-amber-400/40 bg-amber-400/5" : "border-card-border bg-card"}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold">
            Your Hand ({myHand.length} card{myHand.length !== 1 ? "s" : ""})
          </span>
          {isMyTurn && <span className="text-[10px] font-bold text-amber-500 animate-pulse">YOUR TURN</span>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {myHand.map((card, i) => {
            const playable = isMyTurn && isCardPlayable(card, gameState);
            const selected = selectedCardIdx === i;
            const isNewlyDrawn = drawnIndices.has(i);
            return (
              <div key={i} className="relative flex-shrink-0">
                {playable && !selected && (
                  <div
                    className="absolute -inset-1 rounded-xl animate-pulse pointer-events-none"
                    style={{
                      background: `${SUIT_COLORS[card.suit]}22`,
                      boxShadow: `0 0 10px ${SUIT_COLORS[card.suit]}55`,
                    }}
                  />
                )}
                <WhotCard
                  card={card}
                  selectable={playable}
                  selected={selected}
                  onClick={() => handleCardClick(i)}
                  size="md"
                  dimmed={isMyTurn && !playable && !selected}
                  animate={isNewlyDrawn ? "draw" : undefined}
                />
              </div>
            );
          })}
          {myHand.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 w-full text-center">No cards left!</p>
          )}
        </div>
      </div>

    </div>
  );
}
