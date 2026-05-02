import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, transactionsTable, ludoChallengesTable, ludoGamesTable, ludoMovesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createInitialState,
  rollDice,
  getValidMoves,
  applyMove,
  applyDiceRoll,
  forfeit,
  isTimedOut,
  type GameState,
} from "../lib/ludoEngine";

const router: IRouter = Router();

const SYSTEM_FEE_RATE = 0.1;

// ---------------------------------------------------------------------------
// SSE registry — in-memory, keyed by game ID
// ---------------------------------------------------------------------------
type Listener = (data: string) => void;
const sseListeners = new Map<number, Set<Listener>>();

function emitGameUpdate(gameId: number, payload: object): void {
  const listeners = sseListeners.get(gameId);
  if (!listeners || listeners.size === 0) return;
  const msg = JSON.stringify(payload);
  listeners.forEach(fn => fn(msg));
}

function addSseListener(gameId: number, fn: Listener): () => void {
  if (!sseListeners.has(gameId)) sseListeners.set(gameId, new Set());
  sseListeners.get(gameId)!.add(fn);
  return () => {
    const set = sseListeners.get(gameId);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) sseListeners.delete(gameId);
  };
}

// ---------------------------------------------------------------------------
// System user — dedicated ledger identity for capturing house fee revenue
// ---------------------------------------------------------------------------
let _systemUserId: number | null = null;

async function getSystemUserId(): Promise<number> {
  if (_systemUserId !== null) return _systemUserId;

  await db
    .insert(usersTable)
    .values({
      username: "__system__",
      email: "__system__@minenova.internal",
      passwordHash: "__no_login__",
      referralCode: "__SYSTEM__",
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "__system__"))
    .limit(1);

  _systemUserId = row.id;
  return _systemUserId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseBoard(raw: unknown): GameState {
  return raw as GameState;
}

type DbTx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/** Map a thrown error to an HTTP status + JSON response. */
function handleRouteError(err: unknown, res: Response): void {
  if (res.headersSent) return;
  const typed = err as { status?: number; message?: string };
  const status = typeof typed.status === "number" ? typed.status : 500;
  const message = typeof typed.message === "string" ? typed.message : "Internal server error";
  res.status(status).json({ error: message });
}

async function payoutWinner(
  tx: DbTx,
  systemUserId: number,
  winnerId: number,
  entryFee: number,
): Promise<void> {
  const pot = entryFee * 2;
  const systemFee = pot * SYSTEM_FEE_RATE;
  const winnings = pot - systemFee;

  await tx
    .update(usersTable)
    .set({ coinBalance: sql`coin_balance + ${winnings}` })
    .where(eq(usersTable.id, winnerId));

  await tx.insert(transactionsTable).values({
    userId: winnerId,
    type: "ludo_win",
    amount: winnings,
    status: "completed",
    description: `Ludo winnings — won ${pot} coin pot`,
  });

  await tx.insert(transactionsTable).values({
    userId: systemUserId,
    type: "ludo_fee",
    amount: systemFee,
    status: "completed",
    description: `Ludo system fee — 10% of ${pot} coin pot`,
  });
  // No ludo_loss row: loser's coins were already deducted and recorded as
  // ludo_entry at challenge creation / acceptance. Adding another deduction
  // here would double-book without a corresponding balance change.
}

// ---------------------------------------------------------------------------
// GET /api/ludo/challenges — list open challenges
// ---------------------------------------------------------------------------
router.get("/ludo/challenges", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challenges = await db
      .select({
        id: ludoChallengesTable.id,
        creatorId: ludoChallengesTable.creatorId,
        creatorUsername: usersTable.username,
        entryFee: ludoChallengesTable.entryFee,
        status: ludoChallengesTable.status,
        createdAt: ludoChallengesTable.createdAt,
      })
      .from(ludoChallengesTable)
      .leftJoin(usersTable, eq(usersTable.id, ludoChallengesTable.creatorId))
      .where(eq(ludoChallengesTable.status, "open"))
      .orderBy(ludoChallengesTable.createdAt);

    res.json(challenges);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/challenges — create a challenge
// ---------------------------------------------------------------------------
router.post("/ludo/challenges", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);
    if (!fee || fee <= 0) {
      res.status(400).json({ error: "entryFee must be a positive number" });
      return;
    }

    let challengeId = 0;

    await db.transaction(async tx => {
      const claimed = await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${fee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${fee}`))
        .returning({ id: usersTable.id });

      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "ludo_entry",
        amount: -fee,
        status: "completed",
        description: `Ludo entry fee held (${fee} coins)`,
      });

      const [challenge] = await tx
        .insert(ludoChallengesTable)
        .values({ creatorId: req.userId!, entryFee: fee, status: "open" })
        .returning();

      challengeId = challenge.id;
    });

    res.status(201).json({ id: challengeId, entryFee: fee, status: "open" });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/challenges/:id/accept — accept a challenge, start game
// ---------------------------------------------------------------------------
router.post("/ludo/challenges/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [challenge] = await db
      .select()
      .from(ludoChallengesTable)
      .where(eq(ludoChallengesTable.id, challengeId))
      .limit(1);

    if (!challenge) { res.status(404).json({ error: "Challenge not found" }); return; }
    if (challenge.status !== "open") { res.status(409).json({ error: "Challenge is no longer open" }); return; }
    if (challenge.creatorId === req.userId) { res.status(400).json({ error: "Cannot accept your own challenge" }); return; }

    let gameId = 0;

    await db.transaction(async tx => {
      const claimed = await tx
        .update(ludoChallengesTable)
        .set({ status: "matched", opponentId: req.userId })
        .where(and(eq(ludoChallengesTable.id, challengeId), eq(ludoChallengesTable.status, "open")))
        .returning({ id: ludoChallengesTable.id, entryFee: ludoChallengesTable.entryFee, creatorId: ludoChallengesTable.creatorId });

      if (claimed.length === 0) throw Object.assign(new Error("Challenge no longer open"), { status: 409 });

      const { entryFee, creatorId } = claimed[0];

      const deducted = await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${entryFee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${entryFee}`))
        .returning({ id: usersTable.id });

      if (deducted.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "ludo_entry",
        amount: -entryFee,
        status: "completed",
        description: `Ludo entry fee held (${entryFee} coins)`,
      });

      const initialState = createInitialState(creatorId, req.userId!);

      const [game] = await tx
        .insert(ludoGamesTable)
        .values({
          challengeId,
          redPlayerId: creatorId,
          bluePlayerId: req.userId!,
          boardState: initialState as unknown as Record<string, unknown>,
          status: "active",
          entryFee,
        })
        .returning();

      gameId = game.id;

      await tx
        .update(ludoChallengesTable)
        .set({ gameId })
        .where(eq(ludoChallengesTable.id, challengeId));
    });

    res.status(201).json({ gameId });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/ludo/challenges/:id — cancel own open challenge, refund
// ---------------------------------------------------------------------------
router.delete("/ludo/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.transaction(async tx => {
      const cancelled = await tx
        .update(ludoChallengesTable)
        .set({ status: "cancelled" })
        .where(and(
          eq(ludoChallengesTable.id, challengeId),
          eq(ludoChallengesTable.creatorId, req.userId!),
          eq(ludoChallengesTable.status, "open"),
        ))
        .returning({ entryFee: ludoChallengesTable.entryFee });

      if (cancelled.length === 0) {
        const [ch] = await tx.select({ creatorId: ludoChallengesTable.creatorId, status: ludoChallengesTable.status })
          .from(ludoChallengesTable).where(eq(ludoChallengesTable.id, challengeId)).limit(1);
        if (!ch) throw Object.assign(new Error("Challenge not found"), { status: 404 });
        if (ch.creatorId !== req.userId) throw Object.assign(new Error("Not your challenge"), { status: 403 });
        throw Object.assign(new Error("Challenge cannot be cancelled"), { status: 409 });
      }

      const { entryFee } = cancelled[0];

      await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${entryFee}` })
        .where(eq(usersTable.id, req.userId!));

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "ludo_refund",
        amount: entryFee,
        status: "completed",
        description: `Ludo challenge cancelled — entry fee refunded`,
      });
    });

    res.json({ message: "Challenge cancelled and coins refunded" });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ludo/my-game — get current user's active game (if any)
// ---------------------------------------------------------------------------
router.get("/ludo/my-game", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const games = await db
      .select()
      .from(ludoGamesTable)
      .where(
        and(
          eq(ludoGamesTable.status, "active"),
          sql`(red_player_id = ${req.userId} OR blue_player_id = ${req.userId})`,
        ),
      )
      .limit(1);

    if (games.length === 0) { res.json({ game: null }); return; }

    const g = games[0];
    res.json({
      game: {
        id: g.id,
        challengeId: g.challengeId,
        redPlayerId: g.redPlayerId,
        bluePlayerId: g.bluePlayerId,
        boardState: parseBoard(g.boardState),
        status: g.status,
        winnerId: g.winnerId,
        entryFee: g.entryFee,
        startedAt: g.startedAt,
      },
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ludo/games/:id — get game state
// ---------------------------------------------------------------------------
router.get("/ludo/games/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [game] = await db
      .select()
      .from(ludoGamesTable)
      .where(eq(ludoGamesTable.id, gameId))
      .limit(1);

    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
      res.status(403).json({ error: "Not a participant" }); return;
    }

    res.json({
      id: game.id,
      challengeId: game.challengeId,
      redPlayerId: game.redPlayerId,
      bluePlayerId: game.bluePlayerId,
      boardState: parseBoard(game.boardState),
      status: game.status,
      winnerId: game.winnerId,
      entryFee: game.entryFee,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/games/:id/roll — roll dice
// SELECT FOR UPDATE ensures only one concurrent request rolls per turn.
// ---------------------------------------------------------------------------
router.post("/ludo/games/:id/roll", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let diceValue = 0;
    let newState: GameState | null = null;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(ludoGamesTable)
        .where(eq(ludoGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      const state = parseBoard(game.boardState);
      const myIndex: 0 | 1 = game.redPlayerId === req.userId ? 0 : 1;

      if (state.currentTurn !== myIndex) throw Object.assign(new Error("Not your turn"), { status: 409 });
      if (state.diceRolled) throw Object.assign(new Error("Dice already rolled — make your move"), { status: 409 });

      diceValue = rollDice();
      const now = new Date().toISOString();
      newState = applyDiceRoll(state, diceValue, now);

      await tx
        .update(ludoGamesTable)
        .set({
          boardState: newState as unknown as Record<string, unknown>,
          lastMoveAt: new Date(now),
        })
        .where(eq(ludoGamesTable.id, gameId));
    });

    emitGameUpdate(gameId, { type: "rolled", diceValue, state: newState });
    res.json({ diceValue, state: newState });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/games/:id/move — move a piece
// SELECT FOR UPDATE ensures only one concurrent move per game state.
// ---------------------------------------------------------------------------
router.post("/ludo/games/:id/move", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { pieceIndex } = req.body as { pieceIndex?: unknown };
    const idx = Number(pieceIndex);
    if (Number.isNaN(idx) || idx < 0 || idx > 3) {
      res.status(400).json({ error: "pieceIndex must be 0-3" }); return;
    }

    let moveResult: { newState: GameState; captured: boolean; won: boolean } | null = null;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(ludoGamesTable)
        .where(eq(ludoGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      const state = parseBoard(game.boardState);
      const myIndex: 0 | 1 = game.redPlayerId === req.userId ? 0 : 1;

      if (state.currentTurn !== myIndex) throw Object.assign(new Error("Not your turn"), { status: 409 });
      if (!state.diceRolled || state.diceValue === null) {
        throw Object.assign(new Error("Roll the dice first"), { status: 409 });
      }

      const validMoves = getValidMoves(state, myIndex, state.diceValue);
      if (!validMoves.includes(idx)) {
        throw Object.assign(new Error("Invalid move for this piece"), { status: 400 });
      }

      const { newState, captured, won, fromProgress, toProgress } = applyMove(
        state, myIndex, idx, state.diceValue,
      );

      await tx
        .update(ludoGamesTable)
        .set({
          boardState: newState as unknown as Record<string, unknown>,
          status: newState.status,
          winnerId: newState.winnerId,
          lastMoveAt: new Date(),
          endedAt: newState.status === "completed" ? new Date() : undefined,
        })
        .where(eq(ludoGamesTable.id, gameId));

      await tx.insert(ludoMovesTable).values({
        gameId,
        playerId: req.userId!,
        diceValue: state.diceValue!,
        pieceIndex: idx,
        fromProgress,
        toProgress,
        captured,
      });

      if (won && newState.winnerId) {
        const systemUserId = await getSystemUserId();
        await payoutWinner(tx, systemUserId, newState.winnerId, game.entryFee);
      }

      moveResult = { newState, captured, won };
    });

    const r = moveResult!;
    emitGameUpdate(gameId, { type: "moved", pieceIndex: idx, captured: r.captured, won: r.won, state: r.newState });
    res.json({ captured: r.captured, won: r.won, state: r.newState });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/games/:id/forfeit — concede the game
// SELECT FOR UPDATE prevents double payouts from concurrent forfeit calls.
// ---------------------------------------------------------------------------
router.post("/ludo/games/:id/forfeit", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let newState: GameState | null = null;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(ludoGamesTable)
        .where(eq(ludoGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      const state = parseBoard(game.boardState);
      newState = forfeit(state, req.userId!);

      await tx
        .update(ludoGamesTable)
        .set({
          boardState: newState as unknown as Record<string, unknown>,
          status: "completed",
          winnerId: newState.winnerId,
          endedAt: new Date(),
        })
        .where(eq(ludoGamesTable.id, gameId));

      if (newState.winnerId) {
        const systemUserId = await getSystemUserId();
        await payoutWinner(tx, systemUserId, newState.winnerId, game.entryFee);
      }
    });

    emitGameUpdate(gameId, { type: "forfeit", forfeiter: req.userId, state: newState });
    res.json({ message: "Forfeited", state: newState });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/games/:id/claim-timeout — win if opponent timed out
// SELECT FOR UPDATE prevents double payouts from concurrent claims.
// ---------------------------------------------------------------------------
router.post("/ludo/games/:id/claim-timeout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let newState: GameState | null = null;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(ludoGamesTable)
        .where(eq(ludoGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      const state = parseBoard(game.boardState);
      const myIndex: 0 | 1 = game.redPlayerId === req.userId ? 0 : 1;

      if (state.currentTurn === myIndex) {
        throw Object.assign(new Error("It is your turn — opponent has not timed out"), { status: 400 });
      }
      if (!isTimedOut(state)) {
        throw Object.assign(new Error("Opponent has not timed out yet (3 minutes required)"), { status: 400 });
      }

      const opponentId = myIndex === 0 ? game.bluePlayerId : game.redPlayerId;
      newState = forfeit(state, opponentId);

      await tx
        .update(ludoGamesTable)
        .set({
          boardState: newState as unknown as Record<string, unknown>,
          status: "completed",
          winnerId: req.userId,
          endedAt: new Date(),
        })
        .where(eq(ludoGamesTable.id, gameId));

      const systemUserId = await getSystemUserId();
      await payoutWinner(tx, systemUserId, req.userId!, game.entryFee);
    });

    emitGameUpdate(gameId, { type: "timeout", winner: req.userId, state: newState });
    res.json({ message: "Won by timeout", state: newState });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ludo/games/:id/events — SSE stream
// ---------------------------------------------------------------------------
router.get("/ludo/games/:id/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [game] = await db.select().from(ludoGamesTable).where(eq(ludoGamesTable.id, gameId)).limit(1);
    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
      res.status(403).json({ error: "Not a participant" }); return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: string) => { res.write(`data: ${data}\n\n`); };

    send(JSON.stringify({ type: "connected", gameId }));

    const keepAlive = setInterval(() => { res.write(": keep-alive\n\n"); }, 25000);
    const unsubscribe = addSseListener(gameId, send);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

export default router;
