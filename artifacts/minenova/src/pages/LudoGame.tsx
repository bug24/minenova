import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import LudoBoard from "@/components/ludo/LudoBoard";
import DiceFace from "@/components/ludo/DiceFace";
import {
  ludoApi, fetchLudoSettings, getSSEUrl, getValidMovesClient,
  type LudoGame, type GameState, type LudoSettings,
} from "@/lib/ludoApi";
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
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${won ? "bg-amber-400/20" : "bg-destructive/20"}`}>
          {won ? <Trophy className="w-8 h-8 text-amber-400" /> : <Skull className="w-8 h-8 text-destructive" />}
        </div>

        <div>
          <h2 className="text-2xl font-black">
            {won ? "You Won! 🎉" : isSolo ? "Bot Won" : "You Lost"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {won ? "Congratulations! Coins have been credited." : isSolo ? "Better luck next time!" : "Better luck next time!"}
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
          <Button variant="outline" className="flex-1" onClick={onGoLobby}>
            Lobby
          </Button>
          <Button className="flex-1 gap-1" onClick={onGoLobby}
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
}

function PlayerPanel({ label, username, color, isMyTurn, isMe, piecesHome, isBot }: PlayerPanelProps) {
  const bg = color === "red" ? "bg-red-500/10 border-red-500/30" : "bg-blue-500/10 border-blue-500/30";
  const dot = color === "red" ? "bg-red-500" : "bg-blue-500";
  const text = color === "red" ? "text-red-600" : "text-blue-600";

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${bg} ${isMyTurn ? "ring-2 ring-amber-400" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${dot}`}>
        {isBot ? <Bot className="w-3.5 h-3.5" /> : username[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold truncate ${text} flex items-center gap-1`}>
          {isMe ? "You" : isBot ? "Bot" : username}
          {isMe && <span className="text-muted-foreground font-normal"> ({label})</span>}
          {isBot && <span className="text-muted-foreground font-normal text-[10px]"> AI</span>}
        </p>
        <p className="text-[10px] text-muted-foreground">{piecesHome}/4 home</p>
      </div>
      {isMyTurn && (
        <span className="text-[10px] font-bold text-amber-500 animate-pulse shrink-0">
          {isBot ? "BOT…" : "TURN"}
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
  const [forfeiting, setForfeiting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);

  const prevStateRef = useRef<GameState | null>(null);

  const myUserId = user?.id ?? 0;

  const myPlayerIndex: 0 | 1 = game
    ? game.redPlayerId === myUserId ? 0 : 1
    : 0;

  const boardState = game?.boardState ?? null;
  const isMyTurn = boardState?.currentTurn === myPlayerIndex;
  const diceRolled = boardState?.diceRolled ?? false;
  const diceValue = boardState?.diceValue ?? null;

  // Detect solo game
  const isSolo = !!(game && (
    game.redPlayerId === myUserId
      ? game.bluePlayerId !== myUserId
      : game.redPlayerId !== myUserId
  ) && (
    // Check opponent username from boardState
    boardState?.players[myPlayerIndex === 0 ? 1 : 0]?.userId !== myUserId
  ));

  // More reliable: check if bluePlayer is bot via a simple flag on the game data
  // We'll detect based on the username loaded from the game context
  const [opponentUsername, setOpponentUsername] = useState<string>("Opponent");
  const isBotOpponent = opponentUsername === SYSTEM_USERNAME || opponentUsername === "bot" || opponentUsername === "__system__";

  const validMoves =
    boardState && isMyTurn && diceRolled && diceValue
      ? getValidMovesClient(boardState, myPlayerIndex, diceValue)
      : [];

  // Fetch initial game state + opponent username
  useEffect(() => {
    setLoading(true);
    ludoApi<LudoGame & { redUsername?: string; blueUsername?: string }>(`/ludo/games/${gameId}`)
      .then(g => {
        setGame(g);
        prevStateRef.current = g.boardState;
        if (g.status === "completed") setShowResult(true);
        // Determine opponent username
        const oppIdx = g.redPlayerId === myUserId ? 1 : 0;
        const oppUsername = oppIdx === 0
          ? ((g as unknown as Record<string, unknown>).redUsername as string | undefined) ?? "Opponent"
          : ((g as unknown as Record<string, unknown>).blueUsername as string | undefined) ?? "Opponent";
        setOpponentUsername(oppUsername);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load game" }))
      .finally(() => setLoading(false));
  }, [gameId, toast, myUserId]);

  // Ludo settings (for dynamic fee display)
  const { data: ludoSettings = null } = useQuery<LudoSettings>({
    queryKey: ["/api/ludo/settings"],
    queryFn: fetchLudoSettings,
    staleTime: 5 * 60 * 1000,
  });

  // SSE connection with exponential backoff
  useEffect(() => {
    if (!gameId) return;
    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const sseUrl = getSSEUrl(gameId);
      es = new EventSource(sseUrl);

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
          };
          retryDelay = 1000;

          if (event.state) {
            const prev = prevStateRef.current;
            prevStateRef.current = event.state;
            setGame(g => g ? { ...g, boardState: event.state!, status: event.state!.status, winnerId: event.state!.winnerId } : g);

            if (event.type === "rolled" && event.state.currentTurn !== myPlayerIndex) {
              // Opponent rolled — show a brief dice animation
              setRolling(true);
              setTimeout(() => setRolling(false), 600);
            }

            if ((event.type === "moved" || event.type === "forfeit" || event.type === "timeout" || event.type === "abandoned_timeout") && event.state.status === "completed") {
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
  }, [gameId, myPlayerIndex, queryClient]);

  const handleRoll = useCallback(async () => {
    if (rolling || !isMyTurn || diceRolled) return;
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
    if (moving || !isMyTurn || !diceRolled) return;
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
  }, [moving, isMyTurn, diceRolled, gameId, toast]);

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
          <Button variant="outline" className="mt-4" onClick={() => navigate("/ludo")}>Back to Lobby</Button>
        </div>
      </div>
    );
  }

  const myPlayer = boardState.players[myPlayerIndex];
  const oppPlayer = boardState.players[myPlayerIndex === 0 ? 1 : 0];
  const myPiecesHome = myPlayer.pieces.filter(p => p.progress === 57).length;
  const oppPiecesHome = oppPlayer.pieces.filter(p => p.progress === 57).length;
  const oppColor: "red" | "blue" = myPlayerIndex === 0 ? "blue" : "red";
  const myColor: "red" | "blue" = myPlayerIndex === 0 ? "red" : "blue";
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
      />

      {/* Board */}
      <div className="flex justify-center">
        <div className="w-full max-w-sm">
          <LudoBoard
            gameState={boardState}
            myPlayerIndex={myPlayerIndex}
            validMoves={validMoves}
            onPieceClick={handleMove}
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

      {/* Dice + controls */}
      <div className="flex items-center justify-between gap-3 px-2 py-3 bg-card border border-card-border rounded-xl">
        {/* Dice display */}
        <div className="flex items-center gap-2">
          <DiceFace value={diceValue} rolling={rolling} size={52} />
          {diceValue && !rolling && (
            <span className="text-lg font-black">{diceValue}</span>
          )}
          {!diceValue && !rolling && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>

        {/* Status / action */}
        <div className="flex-1 text-center">
          {game.status === "completed" ? (
            <span className="text-sm font-semibold text-primary">Game Over</span>
          ) : isMyTurn ? (
            !diceRolled ? (
              <Button
                onClick={handleRoll}
                disabled={rolling}
                className="gap-2 px-6"
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
              >
                {rolling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4" />}
                {rolling ? "Rolling…" : "Roll Dice"}
              </Button>
            ) : validMoves.length > 0 ? (
              <p className="text-sm font-semibold text-amber-500 animate-pulse">
                Tap a piece to move
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No valid moves — auto-skipping…</p>
            )
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                {isBotTurn ? (
                  <><Bot className="w-3 h-3 text-amber-500" /><span className="text-amber-500">Bot is thinking…</span></>
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

        {/* Dice mini for opponent */}
        {!isMyTurn && diceRolled && diceValue && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Rolled</span>
            <DiceFace value={diceValue} rolling={false} size={36} />
          </div>
        )}
        {(isMyTurn || !diceValue || !diceRolled) && <div className="w-12" />}
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
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleForfeit}
                disabled={forfeiting}
              >
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
