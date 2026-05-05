import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import LudoBoard, { type AnimPiece } from "@/components/ludo/LudoBoard";
import DiceFace from "@/components/ludo/DiceFace";
import {
  ludoApi, fetchLudoSettings, getSSEUrl, getValidMovesClient, sendLudoSignal,
  type LudoGame, type GameState, type LudoSettings,
} from "@/lib/ludoApi";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { useAppSettings } from "@/hooks/useAppSettings";
import VoiceChatButton from "@/components/VoiceChatButton";
import {
  unlockAudio, playDiceRoll, playPieceTap, playPieceMove,
  playCapture, playPieceHome, playWin, playBuzzer,
} from "@/lib/sounds";
import { burstConfetti } from "@/lib/confetti";
import {
  ArrowLeft,
  Trophy,
  Skull,
  RefreshCw,
  Flag,
  Timer,
  Bot,
} from "lucide-react";

const SYSTEM_USERNAME = "__system__";

function useGameId() {
  const params = useParams<{ id: string }>();
  return Number(params.id);
}

function buildProgressSteps(fromProgress: number, toProgress: number): number[] {
  if (toProgress === fromProgress) return [];
  if (fromProgress === -1) return [toProgress];
  const steps: number[] = [];
  for (let p = fromProgress + 1; p <= toProgress; p++) steps.push(p);
  return steps;
}

// ─── Result Modal ───────────────────────────────────────────────────────────

interface ResultModalProps {
  game: LudoGame;
  myUserId: number;
  isSolo: boolean;
  settings: LudoSettings | null;
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
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${won ? "bg-amber-400/20" : "bg-destructive/20"}`}
          style={won ? { boxShadow: "0 0 32px rgba(251,191,36,0.35)" } : {}}
        >
          {won
            ? <Trophy className="w-10 h-10 text-amber-400" />
            : <Skull className="w-10 h-10 text-destructive" />}
        </div>
        <div>
          <h2 className="text-2xl font-black">
            {won ? "You Won! 🎉" : isSolo ? "Bot Won" : "You Lost"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {won ? "Congratulations! Coins have been credited." : "Better luck next time!"}
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
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Entry fee paid</span>
              <span className="font-semibold text-destructive">−{game.entryFee.toFixed(0)} coins</span>
            </div>
            {isSolo && (
              <div className="border-t border-destructive/20 pt-1.5 text-xs text-muted-foreground text-center">
                Platform kept your wager
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onGoLobby}>Lobby</Button>
          <Button className="flex-1 gap-1" onClick={onGoLobby}
            style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}>
            <RefreshCw className="w-3.5 h-3.5" />Play Again
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Player badge strip ──────────────────────────────────────────────────────

interface PlayerBadgeProps {
  username: string;
  color: "red" | "blue";
  isMyTurn: boolean;
  isMe: boolean;
  piecesHome: number;
  isBot?: boolean;
  isSpeaking?: boolean;
}

function PlayerBadge({ username, color, isMyTurn, isMe, piecesHome, isBot, isSpeaking }: PlayerBadgeProps) {
  const dot  = color === "red" ? "bg-red-500"  : "bg-blue-500";
  const text = color === "red" ? "text-red-400" : "text-blue-400";
  const showSpeakingRing = isSpeaking && !isMe;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-card-border transition-all ${isMyTurn ? "ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.25)]" : ""}`}>
      {/* Avatar with speaking ring */}
      <div className="relative flex-shrink-0">
        {showSpeakingRing && (
          <>
            <div className="absolute inset-[-4px] rounded-full border-2 border-emerald-400 animate-ping opacity-70 pointer-events-none" />
            <div className="absolute inset-[-3px] rounded-full border-2 border-emerald-400/50 pointer-events-none" />
          </>
        )}
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white transition-shadow ${dot} ${showSpeakingRing ? "shadow-[0_0_8px_rgba(52,211,153,0.7)]" : ""}`}>
          {isBot ? <Bot className="w-3.5 h-3.5" /> : username[0]?.toUpperCase()}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold truncate ${text}`}>
          {isMe ? "You" : isBot ? "Bot" : username}
          {isMe && <span className="text-muted-foreground font-normal ml-1">(me)</span>}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < piecesHome ? dot : "bg-muted"}`} />
          ))}
          <span className="text-[10px] text-muted-foreground ml-1">{piecesHome}/4</span>
        </div>
      </div>
      {isMyTurn && (
        <span className={`text-[10px] font-black shrink-0 ${isBot ? "text-amber-500" : "text-amber-400"}`}
          style={{ animation: "pulse 1s infinite" }}>
          {isBot ? "THINKING…" : isMe ? "YOUR TURN" : "THEIR TURN"}
        </span>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function LudoGame() {
  const gameId = useGameId();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [game, setGame] = useState<LudoGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [moving, setMoving] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);
  const [forfeiting, setForfeiting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);

  const prevStateRef = useRef<GameState | null>(null);
  const rollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseConnectedOnceRef = useRef(false);
  const myUserId = user?.id ?? 0;

  const myPlayerIndex: 0 | 1 = game
    ? game.redPlayerId === myUserId ? 0 : 1
    : 0;

  const boardState  = game?.boardState ?? null;
  const isMyTurn    = boardState?.currentTurn === myPlayerIndex;
  const diceRolled  = boardState?.diceRolled ?? false;
  const diceValue   = boardState?.diceValue ?? null;
  const diceValues         = boardState?.diceValues ?? null;
  const movesLeft          = boardState?.movesLeft ?? 0;
  const activeDieIndex     = boardState?.activeDieIndex ?? null;
  const primaryMoveNumber  = boardState?.primaryMoveNumber ?? 0;
  const primaryMovesTotal  = boardState?.primaryMovesTotal ?? 0;

  const [opponentUsername, setOpponentUsername] = useState<string>("Opponent");
  const isBotOpponent = opponentUsername === SYSTEM_USERNAME || opponentUsername === "__system__";

  const opponentUserId = game ? (myPlayerIndex === 0 ? game.bluePlayerId : game.redPlayerId) : 0;
  const isVoiceInitiator = myUserId < opponentUserId;

  const sendSignal = useCallback(async (type: string, payload: unknown) => {
    try { await sendLudoSignal(gameId, type, payload); } catch { /* non-fatal */ }
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

  const validMoves =
    boardState && isMyTurn && diceRolled && diceValue && !animating
      ? getValidMovesClient(boardState, myPlayerIndex, diceValue)
      : [];

  // Fetch initial game state
  useEffect(() => {
    setLoading(true);
    ludoApi<LudoGame & { redUsername?: string; blueUsername?: string }>(`/ludo/games/${gameId}`)
      .then(g => {
        setGame(g);
        prevStateRef.current = g.boardState;
        if (g.status === "completed") setShowResult(true);
        const oppIdx = g.redPlayerId === myUserId ? 1 : 0;
        const oppUsername = oppIdx === 0
          ? ((g as unknown as Record<string, unknown>).redUsername as string | undefined) ?? "Opponent"
          : ((g as unknown as Record<string, unknown>).blueUsername as string | undefined) ?? "Opponent";
        setOpponentUsername(oppUsername);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load game" }))
      .finally(() => setLoading(false));
  }, [gameId, toast, myUserId]);

  const { data: ludoSettings = null } = useQuery<LudoSettings>({
    queryKey: ["/api/ludo/settings"],
    queryFn: fetchLudoSettings,
    staleTime: 0,
  });

  const handleAnimDone = useCallback(() => {
    setAnimPiece(null);
    setAnimating(false);
  }, []);

  // Safety net: if animating stays true for >2.5 s (e.g. callback never fired),
  // force-clear it so the player can always interact with the board.
  useEffect(() => {
    if (!animating) return;
    const t = setTimeout(() => {
      setAnimPiece(null);
      setAnimating(false);
    }, 2500);
    return () => clearTimeout(t);
  }, [animating]);

  // SSE
  useEffect(() => {
    if (!gameId) return;
    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      es = new EventSource(getSSEUrl(gameId));
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type: string;
            state?: GameState;
            captured?: boolean;
            captureWin?: boolean;
            won?: boolean;
            diceValue?: number;
            pieceIndex?: number;
            winner?: number;
            signalType?: string;
            from?: number;
            payload?: unknown;
          };
          retryDelay = 1000;

          // On reconnect (second+ "connected" message), re-fetch full state to catch up
          if (event.type === "connected") {
            if (sseConnectedOnceRef.current) {
              ludoApi<LudoGame & { redUsername?: string; blueUsername?: string }>(`/ludo/games/${gameId}`)
                .then(g => { setGame(g); prevStateRef.current = g.boardState; })
                .catch(() => {});
            }
            sseConnectedOnceRef.current = true;
            return;
          }

          if (event.type === "signal" && event.from !== myUserId && event.signalType) {
            handleRemoteSignalRef.current(event.signalType, event.payload);
            return;
          }

          if (event.state) {
            const prevState = prevStateRef.current;
            prevStateRef.current = event.state;
            setGame(g => g ? { ...g, boardState: event.state!, status: event.state!.status, winnerId: event.state!.winnerId } : g);

            if (event.type === "rolled" && event.state.currentTurn !== myPlayerIndex) {
              playDiceRoll();
              if (rollingTimerRef.current) clearTimeout(rollingTimerRef.current);
              setRolling(true);
              rollingTimerRef.current = setTimeout(() => setRolling(false), 650);
            }

            if (event.type === "moved") {
              if (event.captured) {
                playCapture();
              } else {
                let reachedHome = false;
                if (prevState) {
                  for (let pi = 0; pi < 2; pi++) {
                    for (let idx = 0; idx < 4; idx++) {
                      const prev = prevState.players[pi]?.pieces[idx]?.progress;
                      const curr = event.state.players[pi]?.pieces[idx]?.progress;
                      if (prev !== undefined && curr === 57 && prev !== 57) reachedHome = true;
                    }
                  }
                }
                if (reachedHome) playPieceHome();
                else playPieceMove();
              }
            }

            // Max animation steps to prevent very long animations (e.g. capture-win
            // jumps a piece directly to 57, which can produce 50+ steps @ 185ms each).
            // We take the LAST N steps so the piece always visually arrives at the target.
            const MAX_ANIM_STEPS = 6;
            if (event.type === "moved" && prevState) {
              for (let pi = 0; pi < 2; pi++) {
                for (let idx = 0; idx < 4; idx++) {
                  const prevProgress = prevState.players[pi]?.pieces[idx]?.progress;
                  const currProgress = event.state.players[pi]?.pieces[idx]?.progress;
                  if (prevProgress !== undefined && currProgress !== undefined &&
                      currProgress !== prevProgress && currProgress !== -1) {
                    const allSteps = buildProgressSteps(prevProgress, currProgress);
                    const steps = allSteps.length > MAX_ANIM_STEPS
                      ? allSteps.slice(allSteps.length - MAX_ANIM_STEPS)
                      : allSteps;
                    if (steps.length > 0) {
                      setAnimPiece({ playerIndex: pi as 0|1, pieceIdx: idx, steps });
                      setAnimating(true);
                    }
                  }
                }
              }
            }

            if (
              (event.type === "moved" || event.type === "forfeit" || event.type === "timeout" || event.type === "abandoned_timeout") &&
              event.state.status === "completed"
            ) {
              if (event.state.winnerId === myUserId) { playWin(); burstConfetti(); }
              else playBuzzer();
              setShowResult(true);
              queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            }
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es?.close();
        if (!unmounted) {
          retryTimeout = setTimeout(() => { retryDelay = Math.min(retryDelay * 2, 30000); connect(); }, retryDelay);
        }
      };
    };

    connect();
    return () => {
      unmounted = true;
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
      if (rollingTimerRef.current) clearTimeout(rollingTimerRef.current);
    };
  }, [gameId, myPlayerIndex, myUserId, queryClient]);

  const handleRoll = useCallback(async () => {
    if (rolling || !isMyTurn || diceRolled) return;
    unlockAudio();
    playDiceRoll();
    setRolling(true);
    try {
      await ludoApi(`/ludo/games/${gameId}/roll`, { method: "POST" });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setRolling(false);
    }
  }, [rolling, isMyTurn, diceRolled, gameId, toast]);

  const handleMove = useCallback(async (pieceIndex: number) => {
    if (moving || animating || !isMyTurn || !diceRolled) return;
    playPieceTap();
    setMoving(true);
    try {
      await ludoApi(`/ludo/games/${gameId}/move`, { method: "POST", body: JSON.stringify({ pieceIndex }) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setMoving(false);
    }
  }, [moving, animating, isMyTurn, diceRolled, gameId, toast]);

  const handleForfeit = useCallback(async () => {
    setForfeiting(true);
    try {
      await ludoApi(`/ludo/games/${gameId}/forfeit`, { method: "POST" });
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
      await ludoApi(`/ludo/games/${gameId}/claim-timeout`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    }
  }, [gameId, queryClient, toast]);

  const canClaimTimeout = (() => {
    if (!boardState || isMyTurn || !boardState.lastMoveAt) return false;
    return Date.now() - new Date(boardState.lastMoveAt).getTime() > 3 * 60 * 1000;
  })();

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Loading game…</p>
      </div>
    </div>
  );

  if (!game || !boardState) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Game not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/ludo")}>Back to Lobby</Button>
      </div>
    </div>
  );

  const myPlayer      = boardState.players[myPlayerIndex];
  const oppPlayer     = boardState.players[myPlayerIndex === 0 ? 1 : 0];
  const myPiecesHome  = myPlayer.pieces.filter(p => p.progress === 57).length;
  const oppPiecesHome = oppPlayer.pieces.filter(p => p.progress === 57).length;
  const oppColor: "red" | "blue" = myPlayerIndex === 0 ? "blue" : "red";
  const myColor:  "red" | "blue" = myPlayerIndex === 0 ? "red"  : "blue";
  const isBotTurn = boardState.currentTurn !== myPlayerIndex && isBotOpponent;
  const canRoll = isMyTurn && !diceRolled && game.status === "active" && !rolling;

  const myDisplayName  = user?.username ?? "You";
  const oppDisplayName = isBotOpponent ? "Bot" : opponentUsername;

  const playerNames: [string, string] = myPlayerIndex === 0
    ? [myDisplayName, oppDisplayName]
    : [oppDisplayName, myDisplayName];

  return (
    <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/ludo")}
          className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
          <ArrowLeft className="w-4 h-4" />Lobby
        </button>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          Game #{game.id} · {game.entryFee} coins
          {isBotOpponent && (
            <span className="text-amber-500 flex items-center gap-0.5">
              · <Bot className="w-3 h-3" /> Solo
            </span>
          )}
        </span>
        <button onClick={() => setShowForfeitConfirm(true)}
          className="flex items-center gap-1 text-xs text-destructive active:opacity-60">
          <Flag className="w-3.5 h-3.5" />Forfeit
        </button>
      </div>

      {/* Opponent badge */}
      <PlayerBadge
        username={oppDisplayName}
        color={oppColor}
        isMyTurn={boardState.currentTurn !== myPlayerIndex}
        isMe={false}
        piecesHome={oppPiecesHome}
        isBot={isBotOpponent}
        isSpeaking={voiceChat.isRemoteSpeaking}
      />

      {/* Opponent thinking indicator */}
      {isBotTurn && (
        <div className="flex items-center gap-1.5 justify-center py-0.5">
          <Bot className="w-3 h-3 text-amber-500" />
          <span className="text-xs text-amber-500 font-semibold">Bot is thinking…</span>
        </div>
      )}

      {/* ── BOARD ── */}
      <div className="flex justify-center">
        <div className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)" }}>
          <LudoBoard
            gameState={boardState}
            myPlayerIndex={myPlayerIndex}
            validMoves={validMoves}
            onPieceClick={handleMove}
            animPiece={animPiece}
            onAnimDone={handleAnimDone}
            rolling={rolling}
            diceValue={diceValue}
            diceValues={diceValues}
            movesLeft={movesLeft}
            activeDieIndex={activeDieIndex}
            canRoll={canRoll}
            onDiceRoll={handleRoll}
            playerNames={playerNames}
            isBot={isBotOpponent}
          />
        </div>
      </div>

      {/* ── DICE PANEL — rendered below the board so it never overlaps pieces ── */}
      {game.status === "active" && (
        <div className="flex justify-center items-center gap-3">
          {/* Voice chat — beside the dice box */}
          {!isBotOpponent && voiceChatEnabled && (
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
          <div
            onClick={canRoll && !rolling ? handleRoll : undefined}
            className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl bg-card border border-card-border"
            style={{
              cursor: canRoll && !rolling ? "pointer" : "default",
              boxShadow: canRoll && !rolling
                ? "0 0 20px 8px rgba(251,191,36,0.45)"
                : rolling
                ? "0 0 14px 4px rgba(255,255,255,0.25)"
                : "0 2px 10px rgba(0,0,0,0.35)",
              transition: "box-shadow 0.3s ease",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* Die 1 */}
              {(() => {
                const die1Active = diceValues !== null && !rolling && activeDieIndex === 0;
                const die1Dimmed = diceValues !== null && !rolling && activeDieIndex === 1;
                return (
                  <div style={{
                    borderRadius: 8,
                    outline: die1Active ? "2.5px solid #fbbf24" : "none",
                    boxShadow: die1Active ? "0 0 8px rgba(251,191,36,0.7)" : "none",
                    transition: "all 0.2s ease",
                    opacity: die1Dimmed ? 0.4 : 1,
                  }}>
                    <DiceFace
                      value={diceValues ? diceValues[0] : (diceValue ?? null)}
                      rolling={rolling}
                      size={48}
                      onRoll={handleRoll}
                      canRoll={canRoll}
                    />
                  </div>
                );
              })()}

              {/* Die 2 */}
              {(() => {
                const die2Active = diceValues !== null && !rolling && activeDieIndex === 1;
                const die2Dimmed = diceValues !== null && !rolling && activeDieIndex === 0;
                return (
                  <div style={{
                    borderRadius: 8,
                    outline: die2Active ? "2.5px solid #fbbf24" : "none",
                    boxShadow: die2Active ? "0 0 8px rgba(251,191,36,0.7)" : "none",
                    transition: "all 0.2s ease",
                    opacity: die2Dimmed ? 0.4 : 1,
                  }}>
                    <DiceFace
                      value={diceValues ? diceValues[1] : null}
                      rolling={rolling}
                      size={48}
                    />
                  </div>
                );
              })()}
            </div>

            {canRoll && !rolling && (
              <p className="text-[11px] font-black tracking-widest text-amber-400"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7)", lineHeight: 1 }}>
                TAP TO ROLL
              </p>
            )}
            {diceValues !== null && !rolling && !canRoll && (
              <p className="text-xs font-black text-white/80"
                style={{ lineHeight: 1 }}>
                {diceValues[0]} · {diceValues[1]}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Status / instruction strip */}
      {game.status === "active" && (
        <div className="flex items-center justify-center min-h-[28px]">
          {isMyTurn && diceRolled && validMoves.length > 0 && (
            <p className="text-sm font-black text-amber-400 animate-pulse tracking-wide">
              ↑ TAP A HIGHLIGHTED PIECE
              {movesLeft > 0 && (
                <span className="ml-2 text-xs font-semibold text-amber-300 normal-case">
                  {activeDieIndex !== null
                    ? `(move ${primaryMoveNumber} of ${primaryMovesTotal})`
                    : "(bonus)"}
                </span>
              )}
            </p>
          )}
          {isMyTurn && diceRolled && validMoves.length === 0 && (
            <p className="text-xs text-muted-foreground">No valid moves — turn passing…</p>
          )}
          {!isMyTurn && !isBotTurn && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Waiting for opponent…
            </p>
          )}
          {canClaimTimeout && (
            <button onClick={handleClaimTimeout}
              className="text-xs text-amber-500 flex items-center gap-1">
              <Timer className="w-3 h-3" />Claim timeout win
            </button>
          )}
        </div>
      )}
      {game.status === "completed" && (
        <p className="text-center text-sm font-semibold text-primary">Game Over</p>
      )}

      {/* My badge */}
      <PlayerBadge
        username={myDisplayName}
        color={myColor}
        isMyTurn={isMyTurn}
        isMe={true}
        piecesHome={myPiecesHome}
      />

      {/* Forfeit confirm */}
      {showForfeitConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
          <div className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-xs text-center space-y-4">
            <Flag className="w-10 h-10 text-destructive mx-auto" />
            <div>
              <h3 className="font-bold">Forfeit the game?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                You'll lose your {game.entryFee} coin entry fee.
                {isBotOpponent ? " The platform keeps your wager." : " Your opponent wins."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForfeitConfirm(false)}>Keep Playing</Button>
              <Button variant="destructive" className="flex-1" onClick={handleForfeit} disabled={forfeiting}>
                {forfeiting ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Forfeit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Result modal */}
      {showResult && game.status === "completed" && (
        <ResultModal
          game={game}
          myUserId={myUserId}
          isSolo={isBotOpponent}
          settings={ludoSettings}
          onGoLobby={() => navigate("/ludo")}
        />
      )}
    </div>
  );
}
