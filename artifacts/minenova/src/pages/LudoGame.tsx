import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import LudoBoard from "@/components/ludo/LudoBoard";
import DiceFace from "@/components/ludo/DiceFace";
import { ludoApi, getSSEUrl, getValidMovesClient, type LudoGame, type GameState } from "@/lib/ludoApi";
import {
  Dices,
  ArrowLeft,
  Trophy,
  Skull,
  RefreshCw,
  Flag,
  Timer,
} from "lucide-react";

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
  onGoLobby: () => void;
}

function ResultModal({ game, myUserId, onGoLobby }: ResultModalProps) {
  const won = game.winnerId === myUserId;
  const pot = game.entryFee * 2;
  const fee = pot * 0.1;
  const winnings = pot - fee;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
      <div className="bg-card border border-card-border rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${won ? "bg-amber-400/20" : "bg-destructive/20"}`}>
          {won ? <Trophy className="w-8 h-8 text-amber-400" /> : <Skull className="w-8 h-8 text-destructive" />}
        </div>

        <div>
          <h2 className="text-2xl font-black">
            {won ? "You Won! 🎉" : "You Lost"}
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
              <span className="text-muted-foreground">House fee (10%)</span>
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
            <div className="border-t border-destructive/20 pt-1.5 flex justify-between text-sm text-xs">
              <span className="text-muted-foreground">House fee</span>
              <span className="text-muted-foreground">charged to pot</span>
            </div>
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
}

function PlayerPanel({ label, username, color, isMyTurn, isMe, piecesHome }: PlayerPanelProps) {
  const bg = color === "red" ? "bg-red-500/10 border-red-500/30" : "bg-blue-500/10 border-blue-500/30";
  const dot = color === "red" ? "bg-red-500" : "bg-blue-500";
  const text = color === "red" ? "text-red-600" : "text-blue-600";

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${bg} ${isMyTurn ? "ring-2 ring-amber-400" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${dot}`}>
        {username[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold truncate ${text}`}>
          {isMe ? "You" : username}
          {isMe && <span className="text-muted-foreground font-normal"> ({label})</span>}
        </p>
        <p className="text-[10px] text-muted-foreground">{piecesHome}/4 home</p>
      </div>
      {isMyTurn && (
        <span className="text-[10px] font-bold text-amber-500 animate-pulse shrink-0">TURN</span>
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

  // Derive my player index
  const myPlayerIndex: 0 | 1 = game
    ? game.redPlayerId === myUserId ? 0 : 1
    : 0;

  const boardState = game?.boardState ?? null;
  const isMyTurn = boardState?.currentTurn === myPlayerIndex;
  const diceRolled = boardState?.diceRolled ?? false;
  const diceValue = boardState?.diceValue ?? null;

  const validMoves =
    boardState && isMyTurn && diceRolled && diceValue
      ? getValidMovesClient(boardState, myPlayerIndex, diceValue)
      : [];

  // Fetch initial game state
  useEffect(() => {
    setLoading(true);
    ludoApi<LudoGame>(`/ludo/games/${gameId}`)
      .then(g => {
        setGame(g);
        prevStateRef.current = g.boardState;
        if (g.status === "completed") setShowResult(true);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load game" }))
      .finally(() => setLoading(false));
  }, [gameId, toast]);

  // SSE connection
  useEffect(() => {
    if (!gameId) return;
    const sseUrl = getSSEUrl(gameId);
    const es = new EventSource(sseUrl);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as {
          type: string;
          state?: GameState;
          captured?: boolean;
          won?: boolean;
        };

        if (event.state) {
          setGame(prev => {
            if (!prev) return prev;
            const updated = { ...prev, boardState: event.state!, status: event.state!.status };
            if (event.state!.winnerId) updated.winnerId = event.state!.winnerId;
            return updated;
          });

          // Capture notification
          if (event.captured && event.type === "moved") {
            toast({ title: "💥 A piece was captured!" });
          }

          // Win check
          if (event.state.status === "completed") {
            queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            setShowResult(true);
            setGame(prev => prev ? {
              ...prev,
              status: "completed",
              boardState: event.state!,
              winnerId: event.state!.winnerId,
            } : prev);
          }

          // Reaching home celebration
          const prevState = prevStateRef.current;
          if (prevState) {
            const myPlayer = event.state.players[myPlayerIndex];
            const prevPlayer = prevState.players[myPlayerIndex];
            myPlayer.pieces.forEach((p, i) => {
              if (p.progress === 57 && prevPlayer?.pieces[i]?.progress !== 57) {
                toast({ title: "🏠 Piece reached home!" });
              }
            });
          }
          prevStateRef.current = event.state;
        }
      } catch {
        // malformed message — ignore
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [gameId, queryClient, myPlayerIndex, toast]);

  const handleRoll = useCallback(async () => {
    if (!isMyTurn || diceRolled || rolling) return;
    setRolling(true);
    try {
      const result = await ludoApi<{ diceValue: number; state: GameState }>(
        `/ludo/games/${gameId}/roll`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setGame(prev => prev ? { ...prev, boardState: result.state } : prev);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      // Keep rolling animation going for visual effect
      setTimeout(() => setRolling(false), 800);
    }
  }, [gameId, isMyTurn, diceRolled, rolling, toast]);

  const handleMove = useCallback(async (pieceIndex: number) => {
    if (!isMyTurn || !diceRolled || moving) return;
    setMoving(true);
    try {
      const result = await ludoApi<{ captured: boolean; won: boolean; state: GameState }>(
        `/ludo/games/${gameId}/move`,
        { method: "POST", body: JSON.stringify({ pieceIndex }) },
      );
      setGame(prev => prev ? {
        ...prev,
        boardState: result.state,
        status: result.state.status,
        winnerId: result.state.winnerId,
      } : prev);
      if (result.captured) toast({ title: "💥 Opponent's piece captured!" });
      if (result.won) {
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        setShowResult(true);
      }
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setMoving(false);
    }
  }, [gameId, isMyTurn, diceRolled, moving, toast, queryClient]);

  const handleForfeit = async () => {
    setForfeiting(true);
    try {
      const result = await ludoApi<{ state: GameState }>(`/ludo/games/${gameId}/forfeit`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setGame(prev => prev ? {
        ...prev,
        boardState: result.state,
        status: "completed",
        winnerId: result.state.winnerId,
      } : prev);
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      setShowResult(true);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setForfeiting(false);
      setShowForfeitConfirm(false);
    }
  };

  const handleClaimTimeout = async () => {
    try {
      await ludoApi(`/ludo/games/${gameId}/claim-timeout`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    }
  };

  // Check for timeout eligibility
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

  const redPlayer = boardState.players[0];
  const bluePlayer = boardState.players[1];
  const redUsername = game.redPlayerId === myUserId ? user?.username ?? "You" : "Opponent";
  const blueUsername = game.bluePlayerId === myUserId ? user?.username ?? "You" : "Opponent";

  const myPlayer = boardState.players[myPlayerIndex];
  const oppPlayer = boardState.players[myPlayerIndex === 0 ? 1 : 0];
  const myPiecesHome = myPlayer.pieces.filter(p => p.progress === 57).length;
  const oppPiecesHome = oppPlayer.pieces.filter(p => p.progress === 57).length;
  const oppUsername = myPlayerIndex === 0 ? blueUsername : redUsername;
  const oppColor: "red" | "blue" = myPlayerIndex === 0 ? "blue" : "red";
  const myColor: "red" | "blue" = myPlayerIndex === 0 ? "red" : "blue";

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
        <span className="text-xs text-muted-foreground">Game #{game.id} · {game.entryFee} coins</span>
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
        username={oppUsername}
        color={oppColor}
        isMyTurn={boardState.currentTurn !== myPlayerIndex}
        isMe={false}
        piecesHome={oppPiecesHome}
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
                <RefreshCw className="w-3 h-3 animate-spin" />
                Opponent's turn…
              </p>
              {canClaimTimeout && (
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
                You'll lose your {game.entryFee} coin entry fee. Your opponent wins.
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
          onGoLobby={() => navigate("/ludo")}
        />
      )}
    </div>
  );
}
