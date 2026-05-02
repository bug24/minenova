import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import LudoBoard, { type AnimPiece } from "@/components/ludo/LudoBoard";
import DiceFace from "@/components/ludo/DiceFace";
import {
  ludoApi, fetchLudoSettings, getSSEUrl, getValidMovesClient, sendLudoSignal,
  type LudoGame, type GameState, type LudoSettings,
} from "@/lib/ludoApi";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import VoiceChatButton from "@/components/VoiceChatButton";
import {
  unlockAudio, playDiceRoll, playPieceTap, playPieceMove,
  playCapture, playPieceHome, playWin, playLose,
} from "@/lib/sounds";
import {
  Dices,
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

// ---------------------------------------------------------------------------
// Build progress steps for step animation
// ---------------------------------------------------------------------------
function buildProgressSteps(fromProgress: number, toProgress: number): number[] {
  if (toProgress === fromProgress) return [];
  // Coming out of home base — just one step to entry cell
  if (fromProgress === -1) return [toProgress];
  const steps: number[] = [];
  for (let p = fromProgress + 1; p <= toProgress; p++) {
    steps.push(p);
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Result modal
// ---------------------------------------------------------------------------
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
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${won ? "bg-amber-400/20" : "bg-destructive/20"}`}
          style={won ? { boxShadow: "0 0 32px rgba(251,191,36,0.35)" } : {}}>
          {won
            ? <Trophy className="w-10 h-10 text-amber-400" />
            : <Skull className="w-10 h-10 text-destructive" />}
        </div>

        <div>
          <h2 className="text-2xl font-black">
            {won ? "You Won! 🎉" : isSolo ? "Bot Won" : "You Lost"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {won
              ? "Congratulations! Coins have been credited."
              : "Better luck next time!"}
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
            <RefreshCw className="w-3.5 h-3.5" />
            Play Again
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player panel
// ---------------------------------------------------------------------------
interface PlayerPanelProps {
  label: string;
  username: string;
  color: "red" | "blue";
  isMyTurn: boolean;
  isMe: boolean;
  piecesHome: number;
  isBot?: boolean;
  isSpeaking?: boolean;
}

function PlayerPanel({ label, username, color, isMyTurn, isMe, piecesHome, isBot, isSpeaking }: PlayerPanelProps) {
  const bg   = color === "red" ? "bg-red-500/10 border-red-500/30"   : "bg-blue-500/10 border-blue-500/30";
  const dot  = color === "red" ? "bg-red-500"   : "bg-blue-500";
  const text = color === "red" ? "text-red-500"  : "text-blue-500";
  const speakRing = isSpeaking && !isMe ? "ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.35)]" : "";

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-300 ${bg} ${isMyTurn ? "ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.3)]" : ""} ${speakRing}`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${dot} shadow-sm`}>
        {isBot ? <Bot className="w-4 h-4" /> : username[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold truncate ${text} flex items-center gap-1`}>
          {isMe ? "You" : isBot ? "Bot" : username}
          {isMe && <span className="text-muted-foreground font-normal">({label})</span>}
          {isBot && <span className="text-muted-foreground font-normal text-[10px]">AI</span>}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className="flex gap-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${i < piecesHome ? (color === "red" ? "bg-red-500" : "bg-blue-500") : "bg-muted"}`}
              />
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">{piecesHome}/4 home</span>
        </div>
      </div>
      {isMyTurn && (
        <span className={`text-[11px] font-black shrink-0 ${isBot ? "text-amber-500" : "text-amber-400"}`}
          style={{ animation: "pulse 1s infinite" }}>
          {isBot ? "THINKING…" : "YOUR TURN"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main game component
// ---------------------------------------------------------------------------
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
  const myUserId = user?.id ?? 0;

  const myPlayerIndex: 0 | 1 = game
    ? game.redPlayerId === myUserId ? 0 : 1
    : 0;

  const boardState  = game?.boardState ?? null;
  const isMyTurn    = boardState?.currentTurn === myPlayerIndex;
  const diceRolled  = boardState?.diceRolled ?? false;
  const diceValue   = boardState?.diceValue ?? null;

  const [opponentUsername, setOpponentUsername] = useState<string>("Opponent");
  const isBotOpponent = opponentUsername === SYSTEM_USERNAME || opponentUsername === "__system__";

  const opponentUserId = game ? (myPlayerIndex === 0 ? game.bluePlayerId : game.redPlayerId) : 0;
  const isVoiceInitiator = myUserId < opponentUserId;

  const sendSignal = useCallback(async (type: string, payload: unknown) => {
    try { await sendLudoSignal(gameId, type, payload); } catch { /* non-fatal */ }
  }, [gameId]);

  const voiceChat = useVoiceChat({
    isInitiator: isVoiceInitiator,
    sendSignal,
    enabled: !isBotOpponent && game?.status === "active",
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
    staleTime: 5 * 60 * 1000,
  });

  // Animation done handler
  const handleAnimDone = useCallback(() => {
    setAnimPiece(null);
    setAnimating(false);
  }, []);

  // SSE connection
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
            won?: boolean;
            diceValue?: number;
            pieceIndex?: number;
            winner?: number;
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
            const prevState = prevStateRef.current;
            prevStateRef.current = event.state;

            setGame(g =>
              g ? { ...g, boardState: event.state!, status: event.state!.status, winnerId: event.state!.winnerId } : g
            );

            // Dice roll sound + animation for opponent's roll
            if (event.type === "rolled" && event.state.currentTurn !== myPlayerIndex) {
              playDiceRoll();
              setRolling(true);
              setTimeout(() => setRolling(false), 650);
            }

            // Piece movement sounds
            if (event.type === "moved") {
              if (event.captured) {
                playCapture();
              } else {
                // Detect if any piece reached home (progress 57)
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

            // Step-by-step piece movement animation
            if (event.type === "moved" && prevState) {
              for (let pi = 0; pi < 2; pi++) {
                for (let idx = 0; idx < 4; idx++) {
                  const prevProgress = prevState.players[pi]?.pieces[idx]?.progress;
                  const currProgress = event.state.players[pi]?.pieces[idx]?.progress;
                  if (
                    prevProgress !== undefined &&
                    currProgress !== undefined &&
                    currProgress !== prevProgress &&
                    currProgress !== -1 // captures are handled as flash, not step anim
                  ) {
                    const steps = buildProgressSteps(prevProgress, currProgress);
                    if (steps.length > 0) {
                      setAnimPiece({ playerIndex: pi as 0 | 1, pieceIdx: idx, steps });
                      setAnimating(true);
                    }
                  }
                }
              }
            }

            // Game over
            if (
              (event.type === "moved" || event.type === "forfeit" || event.type === "timeout" || event.type === "abandoned_timeout") &&
              event.state.status === "completed"
            ) {
              if (event.state.winnerId === myUserId) playWin();
              else playLose();
              setShowResult(true);
              queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            }
          }
        } catch {
          // ignore malformed events
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
      await ludoApi(`/ludo/games/${gameId}/move`, {
        method: "POST",
        body: JSON.stringify({ pieceIndex }),
      });
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

  if (!game || !boardState) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Game not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/ludo")}>
            Back to Lobby
          </Button>
        </div>
      </div>
    );
  }

  const myPlayer    = boardState.players[myPlayerIndex];
  const oppPlayer   = boardState.players[myPlayerIndex === 0 ? 1 : 0];
  const myPiecesHome  = myPlayer.pieces.filter(p => p.progress === 57).length;
  const oppPiecesHome = oppPlayer.pieces.filter(p => p.progress === 57).length;
  const oppColor: "red" | "blue" = myPlayerIndex === 0 ? "blue" : "red";
  const myColor:  "red" | "blue" = myPlayerIndex === 0 ? "red"  : "blue";
  const isBotTurn = boardState.currentTurn !== myPlayerIndex && isBotOpponent;

  return (
    <div className="flex flex-col gap-2 px-3 pb-4 pt-2">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/ludo")}
          className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60"
        >
          <ArrowLeft className="w-4 h-4" />
          Lobby
        </button>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          Game #{game.id} · {game.entryFee} coins
          {isBotOpponent && (
            <span className="text-amber-500 flex items-center gap-0.5">
              · <Bot className="w-3 h-3" /> Solo
            </span>
          )}
        </span>
        <button
          onClick={() => setShowForfeitConfirm(true)}
          className="flex items-center gap-1 text-xs text-destructive active:opacity-60"
        >
          <Flag className="w-3.5 h-3.5" />
          Forfeit
        </button>
      </div>

      {/* Opponent panel */}
      <PlayerPanel
        label={oppColor}
        username={opponentUsername}
        color={oppColor}
        isMyTurn={boardState.currentTurn !== myPlayerIndex}
        isMe={false}
        piecesHome={oppPiecesHome}
        isBot={isBotOpponent}
        isSpeaking={voiceChat.isRemoteSpeaking}
      />

      {/* Board */}
      <div className="flex justify-center">
        <div className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)" }}>
          <LudoBoard
            gameState={boardState}
            myPlayerIndex={myPlayerIndex}
            validMoves={validMoves}
            onPieceClick={handleMove}
            animPiece={animPiece}
            onAnimDone={handleAnimDone}
          />
        </div>
      </div>

      {/* My panel */}
      <PlayerPanel
        label={myColor}
        username={user?.username ?? "You"}
        color={myColor}
        isMyTurn={isMyTurn}
        isMe={true}
        piecesHome={myPiecesHome}
      />

      {/* ── Dice + controls ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-3 bg-card border border-card-border rounded-2xl"
        style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.1)" }}>

        {/* Dice */}
        <div className="flex items-center gap-2 shrink-0">
          <DiceFace value={diceValue} rolling={rolling} size={56} />
          {diceValue && !rolling && (
            <span className="text-2xl font-black tabular-nums">{diceValue}</span>
          )}
          {!diceValue && !rolling && (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        {/* Status / action */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          {game.status === "completed" ? (
            <span className="text-sm font-semibold text-primary">Game Over</span>
          ) : isMyTurn ? (
            !diceRolled ? (
              <Button
                onClick={handleRoll}
                disabled={rolling}
                size="sm"
                className="gap-2 px-5 font-bold"
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
              >
                {rolling
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Dices className="w-4 h-4" />}
                {rolling ? "Rolling…" : "Roll Dice"}
              </Button>
            ) : validMoves.length > 0 ? (
              <p className="text-sm font-black text-amber-400 animate-pulse tracking-wide">
                ↑ TAP A PIECE
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No valid moves…</p>
            )
          ) : (
            <div className="space-y-1 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                {isBotTurn ? (
                  <><Bot className="w-3 h-3 text-amber-500" />
                  <span className="text-amber-500 font-semibold">Bot is thinking…</span></>
                ) : (
                  <><RefreshCw className="w-3 h-3 animate-spin" />Opponent's turn…</>
                )}
              </p>
              {!isBotOpponent && canClaimTimeout && (
                <button
                  onClick={handleClaimTimeout}
                  className="text-xs text-amber-500 flex items-center gap-1 mx-auto"
                >
                  <Timer className="w-3 h-3" />
                  Claim timeout win
                </button>
              )}
            </div>
          )}
        </div>

        {/* Opponent's rolled dice (mini) */}
        {!isMyTurn && diceRolled && diceValue && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-muted-foreground">Rolled</span>
            <DiceFace value={diceValue} rolling={false} size={38} />
          </div>
        )}
        {(isMyTurn || !diceValue || !diceRolled) && <div className="w-10 shrink-0" />}
      </div>

      {/* Forfeit confirm overlay */}
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
              <Button variant="outline" className="flex-1" onClick={() => setShowForfeitConfirm(false)}>
                Keep Playing
              </Button>
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

      {/* Voice chat — hidden for bot games and after game ends */}
      {!isBotOpponent && game.status === "active" && (
        <VoiceChatButton
          status={voiceChat.status}
          isMuted={voiceChat.isMuted}
          isRemoteSpeaking={voiceChat.isRemoteSpeaking}
          onStart={voiceChat.start}
          onStop={voiceChat.stop}
          onToggleMute={voiceChat.toggleMute}
        />
      )}
    </div>
  );
}
