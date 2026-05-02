import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, transactionsTable, ludoChallengesTable, ludoGamesTable, ludoMovesTable, adminConfigTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createInitialState,
  rollDice,
  getValidMoves,
  applyMove,
  applyDiceRoll,
  forceEndTurn,
  forfeit,
  isTimedOut,
  type GameState,
} from "../lib/ludoEngine";

const router: IRouter = Router();

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

  // Attempt insert; ignore conflicts (row may already exist from a previous boot).
  // We catch ALL errors here, not just unique violations — a non-username conflict
  // (e.g. duplicate referral_code) would otherwise bypass onConflictDoNothing and
  // leave us with no system row to select below.
  try {
    await db
      .insert(usersTable)
      .values({
        username: "__system__",
        email: "__system__@minenova.internal",
        passwordHash: "__no_login__",
        referralCode: "__SYSTEM__",
      })
      .onConflictDoNothing();
  } catch {
    // Swallow — the select below will either find the row or throw explicitly.
  }

  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "__system__"))
    .limit(1);

  if (rows.length === 0) {
    throw new Error(
      "System accounting user (__system__) could not be created or found. " +
        "Check for a conflicting referral code in the users table.",
    );
  }

  _systemUserId = rows[0].id;
  return _systemUserId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseBoard(raw: unknown): GameState {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("Corrupted game state: not an object"), { status: 500 });
  }
  const s = raw as Record<string, unknown>;
  if (
    typeof s.currentTurn !== "number" ||
    typeof s.diceRolled !== "boolean" ||
    typeof s.status !== "string" ||
    !Array.isArray(s.players) ||
    s.players.length !== 2
  ) {
    throw Object.assign(new Error("Corrupted game state: missing required fields"), { status: 500 });
  }
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

// ---------------------------------------------------------------------------
// Ludo settings helper (reads from admin_config)
// ---------------------------------------------------------------------------
async function getLudoSettings(): Promise<{
  platformFeePct: number;
  winPct: number;
  minFee: number;
  maxFee: number;
  soloFee: number;
  soloEnabled: boolean;
  timeoutMinutes: number;
}> {
  const keys = [
    "ludo_platform_fee_pct", "ludo_win_pct", "ludo_min_fee", "ludo_max_fee",
    "ludo_solo_fee", "ludo_solo_enabled", "ludo_timeout_minutes",
  ];
  const rows = await db.select().from(adminConfigTable)
    .where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return {
    platformFeePct: parseFloat(cfg.ludo_platform_fee_pct ?? "10"),
    winPct: parseFloat(cfg.ludo_win_pct ?? "90"),
    minFee: parseFloat(cfg.ludo_min_fee ?? "10"),
    maxFee: parseFloat(cfg.ludo_max_fee ?? "10000"),
    soloFee: parseFloat(cfg.ludo_solo_fee ?? "100"),
    soloEnabled: (cfg.ludo_solo_enabled ?? "true") === "true",
    timeoutMinutes: parseInt(cfg.ludo_timeout_minutes ?? "5"),
  };
}

async function payoutWinner(
  tx: DbTx,
  systemUserId: number,
  winnerId: number,
  entryFee: number,
  feeRate: number,
): Promise<void> {
  const pot = entryFee * 2;
  const systemFee = pot * feeRate;
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
    description: `Ludo platform fee — ${Math.round(feeRate * 100)}% of ${pot} coin pot`,
  });
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
// GET /api/ludo/challenges/:id — get single challenge (used for waiting-screen polling)
// ---------------------------------------------------------------------------
router.get("/ludo/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [challenge] = await db
      .select({
        id: ludoChallengesTable.id,
        creatorId: ludoChallengesTable.creatorId,
        opponentId: ludoChallengesTable.opponentId,
        entryFee: ludoChallengesTable.entryFee,
        status: ludoChallengesTable.status,
        gameId: ludoChallengesTable.gameId,
        createdAt: ludoChallengesTable.createdAt,
      })
      .from(ludoChallengesTable)
      .where(eq(ludoChallengesTable.id, challengeId))
      .limit(1);

    if (!challenge) { res.status(404).json({ error: "Challenge not found" }); return; }

    // Only allow creator or opponent to view
    if (challenge.creatorId !== req.userId && challenge.opponentId !== req.userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    res.json(challenge);
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
    let botTriggeredByRoll = false;

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

      const d1 = rollDice();
      const d2 = rollDice();
      diceValue = d1; // kept for emit compat; actual active die stored in state
      const now = new Date().toISOString();
      newState = applyDiceRoll(state, [d1, d2], now);

      await tx
        .update(ludoGamesTable)
        .set({
          boardState: newState as unknown as Record<string, unknown>,
          lastMoveAt: new Date(now),
        })
        .where(eq(ludoGamesTable.id, gameId));

    });

    emitGameUpdate(gameId, { type: "rolled", diceValue, state: newState });
    // Trigger bot asynchronously so we never block on a null _systemUserId cache
    if (!newState!.diceRolled && newState!.currentTurn === 1) {
      getSystemUserId().then(sysId => {
        const [g] = [newState!]; // capture for closure
        if (g) {
          // We need bluePlayerId — re-read it from the result kept in closure
          void (async () => {
            const [row] = await db.select({ bluePlayerId: ludoGamesTable.bluePlayerId })
              .from(ludoGamesTable).where(eq(ludoGamesTable.id, gameId)).limit(1);
            if (row && row.bluePlayerId === sysId) triggerBotMove(gameId);
          })();
        }
      }).catch(() => {});
    }
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

    let moveResult: { newState: GameState; captured: boolean; captureWin: boolean; won: boolean; bluePlayerId: number } | null = null;

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

      const { newState, captured, captureWin, won, fromProgress, toProgress } = applyMove(
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
        const { platformFeePct } = await getLudoSettings();
        await payoutWinner(tx, systemUserId, newState.winnerId, game.entryFee, platformFeePct / 100);
      }

      moveResult = { newState, captured, captureWin, won, bluePlayerId: game.bluePlayerId };
    });

    const r = moveResult!;
    emitGameUpdate(gameId, { type: "moved", pieceIndex: idx, captured: r.captured, captureWin: r.captureWin, won: r.won, state: r.newState });
    // Trigger bot asynchronously — avoids stale _systemUserId null on cold boot
    if (!r.won && r.newState.currentTurn === 1) {
      getSystemUserId().then(sysId => {
        if (r.bluePlayerId === sysId) triggerBotMove(gameId);
      }).catch(() => {});
    }
    res.json({ captured: r.captured, captureWin: r.captureWin, won: r.won, state: r.newState });
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
        const { platformFeePct } = await getLudoSettings();
        await payoutWinner(tx, systemUserId, newState.winnerId, game.entryFee, platformFeePct / 100);
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
      const { platformFeePct } = await getLudoSettings();
      await payoutWinner(tx, systemUserId, req.userId!, game.entryFee, platformFeePct / 100);
    });

    emitGameUpdate(gameId, { type: "timeout", winner: req.userId, state: newState });
    res.json({ message: "Won by timeout", state: newState });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ludo/settings — public, returns ludo game settings for display
// ---------------------------------------------------------------------------
router.get("/ludo/settings", async (_req: Request, res: Response): Promise<void> => {
  try {
    const s = await getLudoSettings();
    res.json(s);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ludo/solo — create a solo game vs the AI bot
// ---------------------------------------------------------------------------
router.post("/ludo/solo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);

    const settings = await getLudoSettings();
    if (!settings.soloEnabled) {
      res.status(400).json({ error: "Solo mode is currently disabled" }); return;
    }
    if (!Number.isFinite(fee) || fee < settings.minFee || fee > settings.maxFee) {
      res.status(400).json({ error: `Entry fee must be between ${settings.minFee} and ${settings.maxFee} coins` }); return;
    }

    const systemUserId = await getSystemUserId();
    let gameId = 0;

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
        description: `Ludo solo entry fee — ${fee} coins`,
      });

      const initialState = createInitialState(req.userId!, systemUserId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [game] = await tx.insert(ludoGamesTable).values({
        redPlayerId: req.userId!,
        bluePlayerId: systemUserId,
        boardState: initialState as unknown as Record<string, unknown>,
        status: "active",
        entryFee: fee,
        startedAt: new Date(),
        lastMoveAt: new Date(),
      } as any).returning();
      gameId = game.id;
    });

    res.status(201).json({ gameId });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Bot AI — fires in background after a human move in a solo game
// ---------------------------------------------------------------------------
function triggerBotMove(gameId: number): void {
  void scheduleBotMove(gameId);
}

async function scheduleBotMove(gameId: number): Promise<void> {
  try {
    const botUserId = await getSystemUserId();

    // Roll dice after 1.5 s delay
    await new Promise<void>(r => setTimeout(r, 1500));

    let rolledState: GameState | null = null;
    let rolledDice = 0;

    await db.transaction(async tx => {
      const [game] = await tx.select().from(ludoGamesTable)
        .where(eq(ludoGamesTable.id, gameId)).for("update").limit(1);
      if (!game || game.status !== "active") return;

      const state = parseBoard(game.boardState);
      const botIndex: 0 | 1 = game.redPlayerId === botUserId ? 0 : 1;
      if (state.currentTurn !== botIndex || state.diceRolled) return;

      const bd1 = rollDice();
      const bd2 = rollDice();
      rolledDice = bd1;
      const now = new Date().toISOString();
      rolledState = applyDiceRoll(state, [bd1, bd2], now);

      await tx.update(ludoGamesTable)
        .set({ boardState: rolledState as unknown as Record<string, unknown>, lastMoveAt: new Date(now) })
        .where(eq(ludoGamesTable.id, gameId));
    });

    if (!rolledState) return;
    emitGameUpdate(gameId, { type: "rolled", diceValue: rolledDice, state: rolledState });
    if (!(rolledState as GameState).diceRolled) return; // turn auto-skipped, no move needed

    // Make all bot moves for this turn (dual dice = up to 2 moves per turn)
    let currentState: GameState = rolledState as GameState;
    const botIndex: 0 | 1 = 1; // bot is always blue (index 1) in solo games

    while (currentState.diceRolled && currentState.currentTurn === botIndex && currentState.status === "active") {
      // Wait before each move
      await new Promise<void>(r => setTimeout(r, 800));

      let moveResult: { newState: GameState; captured: boolean; captureWin: boolean; won: boolean; pieceIdx: number } | null = null;

      await db.transaction(async tx => {
        const [game] = await tx.select().from(ludoGamesTable)
          .where(eq(ludoGamesTable.id, gameId)).for("update").limit(1);
        if (!game || game.status !== "active") return;

        const state = parseBoard(game.boardState);
        if (state.currentTurn !== botIndex || !state.diceRolled || state.diceValue === null) return;

        const validMoves = getValidMoves(state, botIndex, state.diceValue);
        if (validMoves.length === 0) {
          // Safety valve: diceRolled=true but no valid moves (e.g. old persisted state).
          // Force-end the turn so the human player isn't permanently locked out.
          const skippedState = forceEndTurn(state);
          await tx.update(ludoGamesTable)
            .set({ boardState: skippedState as unknown as Record<string, unknown>, lastMoveAt: new Date() })
            .where(eq(ludoGamesTable.id, gameId));
          moveResult = { newState: skippedState, captured: false, captureWin: false, won: false, pieceIdx: -1 };
          return;
        }

        // AI strategy: prefer pieces already on track, then highest progress
        const sortedMoves = [...validMoves].sort((a, b) => {
          const pa = state.players[botIndex].pieces[a].progress;
          const pb = state.players[botIndex].pieces[b].progress;
          if (pa === -1 && pb !== -1) return 1;
          if (pb === -1 && pa !== -1) return -1;
          return pb - pa;
        });
        const pieceIdx = sortedMoves[0];
        const { newState, captured, captureWin, won, fromProgress, toProgress } = applyMove(
          state, botIndex, pieceIdx, state.diceValue,
        );

        await tx.update(ludoGamesTable)
          .set({
            boardState: newState as unknown as Record<string, unknown>,
            status: newState.status,
            winnerId: newState.winnerId,
            lastMoveAt: new Date(),
            endedAt: newState.status === "completed" ? new Date() : undefined,
          })
          .where(eq(ludoGamesTable.id, gameId));

        await tx.insert(ludoMovesTable).values({
          gameId, playerId: botUserId, diceValue: state.diceValue,
          pieceIndex: pieceIdx, fromProgress, toProgress, captured,
        });

        if (won) {
          const systemUserId2 = await getSystemUserId();
          await tx.insert(transactionsTable).values({
            userId: systemUserId2,
            type: "ludo_fee",
            amount: game.entryFee,
            status: "completed",
            description: `Ludo solo — bot win, platform retains ${game.entryFee} coins`,
          });
        } else if (won === false && newState.winnerId && newState.winnerId !== botUserId) {
          const { platformFeePct } = await getLudoSettings();
          await payoutWinner(tx, botUserId, newState.winnerId, game.entryFee, platformFeePct / 100);
        }

        moveResult = { newState, captured, captureWin, won, pieceIdx };
      });

      if (!moveResult) break;
      const { newState, captured, captureWin, won, pieceIdx } = moveResult!;
      emitGameUpdate(gameId, { type: "moved", pieceIndex: pieceIdx, captured, captureWin, won, state: newState });
      currentState = newState;

      if (won) break;
    }

    // If still bot's turn after all moves (rolled 6 — extra turn), schedule another round
    if (currentState.status === "active" && currentState.currentTurn === botIndex && !currentState.diceRolled) {
      void scheduleBotMove(gameId);
    }
  } catch {
    // Silently ignore bot errors
  }
}

// ---------------------------------------------------------------------------
// GET /api/ludo/games/:id/events — SSE stream
// EventSource cannot set custom headers, so we also accept ?token=<jwt>
// ---------------------------------------------------------------------------
router.get("/ludo/games/:id/events", async (req: Request, res: Response): Promise<void> => {
  // Promote query-param token to the Authorization header so requireAuth works normally
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token as string}`;
  }
  // Inline auth (requireAuth as a one-shot call)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { verifyToken } = await import("../lib/auth");
  const uid = verifyToken(authHeader.replace("Bearer ", ""));
  if (!uid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  req.userId = uid;

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

// ---------------------------------------------------------------------------
// POST /api/ludo/games/:id/signal — relay WebRTC signalling via SSE
// ---------------------------------------------------------------------------
router.post("/ludo/games/:id/signal", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { type, payload } = req.body as { type?: string; payload?: unknown };
    if (!type || !["offer", "answer", "ice-candidate"].includes(type)) {
      res.status(400).json({ error: "Invalid signal type" }); return;
    }

    const [game] = await db
      .select({ redPlayerId: ludoGamesTable.redPlayerId, bluePlayerId: ludoGamesTable.bluePlayerId, status: ludoGamesTable.status })
      .from(ludoGamesTable)
      .where(eq(ludoGamesTable.id, gameId))
      .limit(1);

    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    if (game.redPlayerId !== req.userId && game.bluePlayerId !== req.userId) {
      res.status(403).json({ error: "Not a participant" }); return;
    }
    if (game.status !== "active") { res.status(409).json({ error: "Game is not active" }); return; }

    emitGameUpdate(gameId, { type: "signal", signalType: type, from: req.userId, payload });
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

export default router;

// ---------------------------------------------------------------------------
// Abandoned-game sweep — runs every 2 minutes
// Forfeits any active game where last_move_at > timeout_minutes old
// ---------------------------------------------------------------------------
setInterval(async () => {
  try {
    const { timeoutMinutes, platformFeePct } = await getLudoSettings();
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const timedOutGames = await db
      .select()
      .from(ludoGamesTable)
      .where(and(
        eq(ludoGamesTable.status, "active"),
        sql`last_move_at < ${cutoff}`,
      ))
      .limit(20);

    if (timedOutGames.length === 0) return;
    const systemUserId = await getSystemUserId();

    for (const game of timedOutGames) {
      try {
        let winnerId: number | null = null;

        await db.transaction(async tx => {
          const [g] = await tx.select().from(ludoGamesTable)
            .where(and(eq(ludoGamesTable.id, game.id), eq(ludoGamesTable.status, "active")))
            .for("update").limit(1);
          if (!g) return;

          const state = parseBoard(g.boardState);
          const forfeiterUserId = state.currentTurn === 0 ? g.redPlayerId : g.bluePlayerId;
          const wId = state.currentTurn === 0 ? g.bluePlayerId : g.redPlayerId;
          const newState = forfeit(state, forfeiterUserId);
          winnerId = wId;

          await tx.update(ludoGamesTable)
            .set({
              boardState: newState as unknown as Record<string, unknown>,
              status: "completed",
              winnerId: wId,
              endedAt: new Date(),
            })
            .where(eq(ludoGamesTable.id, g.id));

          // Only pay out if winner is a real human (not the system bot)
          if (wId !== systemUserId) {
            await payoutWinner(tx, systemUserId, wId, g.entryFee, platformFeePct / 100);
          } else {
            // Bot won due to human abandoning — record fee income
            await tx.insert(transactionsTable).values({
              userId: systemUserId,
              type: "ludo_fee",
              amount: g.entryFee,
              status: "completed",
              description: `Ludo solo abandoned — platform retains ${g.entryFee} coins`,
            });
          }
        });

        if (winnerId !== null) {
          emitGameUpdate(game.id, { type: "abandoned_timeout", winner: winnerId });
        }
      } catch {
        // Ignore per-game errors — continue sweep
      }
    }
  } catch {
    // Ignore sweep errors
  }
}, 2 * 60 * 1000);
