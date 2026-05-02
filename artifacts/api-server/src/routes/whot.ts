import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, transactionsTable, whotChallengesTable, whotGamesTable, whotMovesTable, adminConfigTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  createInitialState,
  applyPlay,
  applyDraw,
  forfeit,
  isTimedOut,
  botChooseAction,
  getPlayableCards,
  drawOneCardRetain,
  type GameState,
  type Suit,
  type Card,
} from "../lib/whotEngine";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// SSE registry — nested per-player so each listener gets a sanitized view
// ---------------------------------------------------------------------------
type Listener = (data: string) => void;
// gameId → userId → Set<Listener>
const sseListeners = new Map<number, Map<number, Set<Listener>>>();

function sanitiseState(state: GameState, viewerUserId: number, player0Id: number): GameState {
  const myIndex: 0 | 1 = player0Id === viewerUserId ? 0 : 1;
  return {
    ...state,
    players: [
      myIndex === 0
        ? state.players[0]
        : { ...state.players[0], hand: state.players[0].hand.map(() => ({ suit: "WHOT" as const, value: 0 })) },
      myIndex === 1
        ? state.players[1]
        : { ...state.players[1], hand: state.players[1].hand.map(() => ({ suit: "WHOT" as const, value: 0 })) },
    ],
    deck: state.deck.map(() => ({ suit: "WHOT" as const, value: 0 })),
  };
}

function emitGameUpdate(
  gameId: number,
  type: string,
  rawState: GameState,
  player0Id: number,
  player1Id: number,
  extra: Record<string, unknown> = {},
): void {
  const byUser = sseListeners.get(gameId);
  if (!byUser || byUser.size === 0) return;
  byUser.forEach((listeners, userId) => {
    if (listeners.size === 0) return;
    const sanitized = sanitiseState(rawState, userId, player0Id);
    const payload = JSON.stringify({ type, state: sanitized, ...extra });
    listeners.forEach(fn => fn(payload));
  });
}

function addSseListener(gameId: number, userId: number, fn: Listener): () => void {
  if (!sseListeners.has(gameId)) sseListeners.set(gameId, new Map());
  const byUser = sseListeners.get(gameId)!;
  if (!byUser.has(userId)) byUser.set(userId, new Set());
  byUser.get(userId)!.add(fn);
  return () => {
    const byUser2 = sseListeners.get(gameId);
    if (!byUser2) return;
    const set = byUser2.get(userId);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) byUser2.delete(userId);
    if (byUser2.size === 0) sseListeners.delete(gameId);
  };
}

// ---------------------------------------------------------------------------
// System user
// ---------------------------------------------------------------------------
let _systemUserId: number | null = null;

async function getSystemUserId(): Promise<number> {
  if (_systemUserId !== null) return _systemUserId;
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
    // ignore — user may already exist
  }
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "__system__"))
    .limit(1);
  if (rows.length === 0) throw new Error("System user not found");
  _systemUserId = rows[0].id;
  return _systemUserId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseState(raw: unknown): GameState {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("Corrupted game state"), { status: 500 });
  }
  const s = raw as Record<string, unknown>;
  if (
    typeof s.currentTurn !== "number" ||
    typeof s.status !== "string" ||
    !Array.isArray(s.players) ||
    s.players.length !== 2 ||
    !Array.isArray(s.discardPile) ||
    !Array.isArray(s.deck)
  ) {
    throw Object.assign(new Error("Corrupted game state: missing fields"), { status: 500 });
  }
  return raw as GameState;
}

type DbTx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

function handleRouteError(err: unknown, res: Response): void {
  if (res.headersSent) return;
  const typed = err as { status?: number; message?: string };
  const status = typeof typed.status === "number" ? typed.status : 500;
  const message = typeof typed.message === "string" ? typed.message : "Internal server error";
  res.status(status).json({ error: message });
}

// ---------------------------------------------------------------------------
// WHOT settings
// ---------------------------------------------------------------------------
async function getWhotSettings() {
  const keys = [
    "whot_platform_fee_pct", "whot_win_pct", "whot_min_fee", "whot_max_fee",
    "whot_solo_fee", "whot_solo_enabled", "whot_timeout_minutes",
  ];
  const rows = await db.select().from(adminConfigTable)
    .where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return {
    platformFeePct: parseFloat(cfg.whot_platform_fee_pct ?? "10"),
    winPct: parseFloat(cfg.whot_win_pct ?? "90"),
    minFee: parseFloat(cfg.whot_min_fee ?? "10"),
    maxFee: parseFloat(cfg.whot_max_fee ?? "10000"),
    soloFee: parseFloat(cfg.whot_solo_fee ?? "100"),
    soloEnabled: (cfg.whot_solo_enabled ?? "true") === "true",
    timeoutMinutes: parseInt(cfg.whot_timeout_minutes ?? "5"),
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
    type: "whot_win",
    amount: winnings,
    status: "completed",
    description: `WHOT winnings — won ${pot} coin pot`,
  });

  await tx.insert(transactionsTable).values({
    userId: systemUserId,
    type: "whot_fee",
    amount: systemFee,
    status: "completed",
    description: `WHOT platform fee — ${Math.round(feeRate * 100)}% of ${pot} coin pot`,
  });
}

// ---------------------------------------------------------------------------
// Bot move trigger
// ---------------------------------------------------------------------------
function triggerBotMove(gameId: number): void {
  setImmediate(async () => {
    try {
      let newState: GameState | null = null;
      let continueBotTurn = false;

      await db.transaction(async tx => {
        const [game] = await tx
          .select()
          .from(whotGamesTable)
          .where(eq(whotGamesTable.id, gameId))
          .for("update")
          .limit(1);

        if (!game || game.status !== "active") return;

        const systemUserId = await getSystemUserId();
        if (game.player1Id !== systemUserId) return;

        const state = parseState(game.gameState);
        if (state.currentTurn !== 1) return;

        // --- Bot move computation with draw-retry (up to 3 draws) ---
        const botMoves: Array<{
          action: string;
          cardPlayed: Record<string, unknown> | null;
          calledSuit: string | null;
          drewCount: number;
        }> = [];

        if (state.pendingPickCount > 0) {
          // Forced pick resolution — draw the pending count and pass turn
          newState = applyDraw(state, 1);
          botMoves.push({ action: "draw", cardPlayed: null, calledSuit: null, drewCount: state.pendingPickCount });
        } else {
          let botState = state;
          let choice = botChooseAction(botState);
          let drawCount = 0;
          const MAX_DRAWS = 3;

          while (choice.action === "draw" && drawCount < MAX_DRAWS) {
            botState = drawOneCardRetain(botState, 1);
            drawCount++;
            botMoves.push({ action: "draw", cardPlayed: null, calledSuit: null, drewCount: 1 });
            choice = botChooseAction(botState);
          }

          if (choice.action === "play") {
            const cardToPlay = botState.players[1].hand[choice.cardIndex!] as unknown as Record<string, unknown>;
            newState = applyPlay(botState, 1, choice.cardIndex!, choice.calledSuit ?? null);
            botMoves.push({ action: "play", cardPlayed: cardToPlay, calledSuit: choice.calledSuit ?? null, drewCount: 0 });
          } else {
            // Max draws exhausted — pass turn to player
            newState = { ...botState, currentTurn: 0 as const, lastMoveAt: new Date().toISOString() };
            if (botMoves.length === 0) {
              botMoves.push({ action: "draw", cardPlayed: null, calledSuit: null, drewCount: 0 });
            }
          }
        }

        const now = new Date();
        const updates: Partial<typeof whotGamesTable.$inferSelect> = {
          gameState: newState as unknown as Record<string, unknown>,
          lastMoveAt: now,
        };

        if (newState.status === "completed") {
          updates.status = "completed";
          updates.winnerId = newState.winnerId;
          updates.endedAt = now;
        }

        await tx
          .update(whotGamesTable)
          .set(updates)
          .where(eq(whotGamesTable.id, gameId));

        for (const m of botMoves) {
          await tx.insert(whotMovesTable).values({
            gameId,
            playerId: systemUserId,
            action: m.action,
            cardPlayed: m.cardPlayed,
            calledSuit: m.calledSuit,
            drewCount: m.drewCount,
          });
        }

        if (newState.status === "completed") {
          const { platformFeePct } = await getWhotSettings();
          if (newState.winnerId === systemUserId) {
            // Bot wins solo — platform retains the player's entry fee
            await tx.insert(transactionsTable).values({
              userId: systemUserId,
              type: "whot_fee",
              amount: game.entryFee,
              status: "completed",
              description: `WHOT solo — bot win, platform retains ${game.entryFee} coins`,
            });
          } else {
            await payoutWinner(tx, systemUserId, newState.winnerId!, game.entryFee, platformFeePct / 100);
          }
        }

        continueBotTurn = newState.status === "active" && newState.currentTurn === 1;
      });

      if (newState) {
        const [g] = await db.select({ p0: whotGamesTable.player0Id, p1: whotGamesTable.player1Id }).from(whotGamesTable).where(eq(whotGamesTable.id, gameId)).limit(1);
        if (g) emitGameUpdate(gameId, "bot_move", newState, g.p0, g.p1);
        if (continueBotTurn) {
          await new Promise(r => setTimeout(r, 600));
          triggerBotMove(gameId);
        }
      }
    } catch (err) {
      // bot move errors are non-fatal
      console.error("WHOT bot move error:", err);
    }
  });
}

// ---------------------------------------------------------------------------
// GET /api/whot/settings
// ---------------------------------------------------------------------------
router.get("/whot/settings", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getWhotSettings());
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whot/challenges
// ---------------------------------------------------------------------------
router.get("/whot/challenges", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challenges = await db
      .select({
        id: whotChallengesTable.id,
        creatorId: whotChallengesTable.creatorId,
        creatorUsername: usersTable.username,
        entryFee: whotChallengesTable.entryFee,
        status: whotChallengesTable.status,
        createdAt: whotChallengesTable.createdAt,
      })
      .from(whotChallengesTable)
      .leftJoin(usersTable, eq(usersTable.id, whotChallengesTable.creatorId))
      .where(eq(whotChallengesTable.status, "open"))
      .orderBy(whotChallengesTable.createdAt);

    res.json(challenges);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/challenges — create challenge
// ---------------------------------------------------------------------------
router.post("/whot/challenges", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);
    const settings = await getWhotSettings();

    if (!Number.isFinite(fee) || fee < settings.minFee || fee > settings.maxFee) {
      res.status(400).json({ error: `Entry fee must be between ${settings.minFee} and ${settings.maxFee} coins` }); return;
    }

    let newChallenge: { id: number; entryFee: number } | null = null;

    await db.transaction(async tx => {
      const claimed = await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${fee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${fee}`))
        .returning({ id: usersTable.id });
      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "whot_entry",
        amount: -fee,
        status: "completed",
        description: `WHOT challenge created — ${fee} coins`,
      });

      const [ch] = await tx.insert(whotChallengesTable).values({
        creatorId: req.userId!,
        entryFee: fee,
        status: "open",
      }).returning();
      newChallenge = { id: ch.id, entryFee: ch.entryFee };
    });

    res.json(newChallenge);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whot/challenges/:id
// ---------------------------------------------------------------------------
router.get("/whot/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [ch] = await db
      .select({
        id: whotChallengesTable.id,
        creatorId: whotChallengesTable.creatorId,
        creatorUsername: usersTable.username,
        entryFee: whotChallengesTable.entryFee,
        status: whotChallengesTable.status,
        gameId: whotChallengesTable.gameId,
        createdAt: whotChallengesTable.createdAt,
      })
      .from(whotChallengesTable)
      .leftJoin(usersTable, eq(usersTable.id, whotChallengesTable.creatorId))
      .where(eq(whotChallengesTable.id, id))
      .limit(1);

    if (!ch) { res.status(404).json({ error: "Challenge not found" }); return; }
    res.json(ch);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/whot/challenges/:id — cancel & refund
// ---------------------------------------------------------------------------
router.delete("/whot/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.transaction(async tx => {
      const [ch] = await tx
        .select()
        .from(whotChallengesTable)
        .where(eq(whotChallengesTable.id, id))
        .for("update")
        .limit(1);

      if (!ch) throw Object.assign(new Error("Challenge not found"), { status: 404 });
      if (ch.creatorId !== req.userId) throw Object.assign(new Error("Not your challenge"), { status: 403 });
      if (ch.status !== "open") throw Object.assign(new Error("Cannot cancel — challenge is no longer open"), { status: 409 });

      await tx.update(whotChallengesTable)
        .set({ status: "cancelled" })
        .where(eq(whotChallengesTable.id, id));

      await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${ch.entryFee}` })
        .where(eq(usersTable.id, req.userId!));

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "whot_refund",
        amount: ch.entryFee,
        status: "completed",
        description: `WHOT challenge #${id} cancelled — refund`,
      });
    });

    res.json({ message: "Challenge cancelled and entry fee refunded" });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/challenges/:id/accept
// ---------------------------------------------------------------------------
router.post("/whot/challenges/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    let gameId = 0;

    await db.transaction(async tx => {
      const [ch] = await tx
        .select()
        .from(whotChallengesTable)
        .where(eq(whotChallengesTable.id, id))
        .for("update")
        .limit(1);

      if (!ch) throw Object.assign(new Error("Challenge not found"), { status: 404 });
      if (ch.status !== "open") throw Object.assign(new Error("Challenge no longer available"), { status: 409 });
      if (ch.creatorId === req.userId) throw Object.assign(new Error("Cannot accept your own challenge"), { status: 400 });

      const fee = ch.entryFee;

      const claimed = await tx
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${fee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${fee}`))
        .returning({ id: usersTable.id });
      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "whot_entry",
        amount: -fee,
        status: "completed",
        description: `WHOT challenge #${id} accepted — ${fee} coins`,
      });

      const initialState = createInitialState(ch.creatorId, req.userId!);
      const [game] = await tx.insert(whotGamesTable).values({
        challengeId: id,
        player0Id: ch.creatorId,
        player1Id: req.userId!,
        gameState: initialState as unknown,
        status: "active",
        entryFee: fee,
        startedAt: new Date(),
        lastMoveAt: new Date(),
      }).returning();
      gameId = game.id;

      await tx.update(whotChallengesTable).set({
        status: "matched",
        opponentId: req.userId,
        gameId,
      }).where(eq(whotChallengesTable.id, id));
    });

    res.json({ gameId });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/solo
// ---------------------------------------------------------------------------
router.post("/whot/solo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);
    const settings = await getWhotSettings();

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
        type: "whot_entry",
        amount: -fee,
        status: "completed",
        description: `WHOT solo entry fee — ${fee} coins`,
      });

      const initialState = createInitialState(req.userId!, systemUserId);
      const [game] = await tx.insert(whotGamesTable).values({
        player0Id: req.userId!,
        player1Id: systemUserId,
        gameState: initialState as unknown,
        status: "active",
        entryFee: fee,
        startedAt: new Date(),
        lastMoveAt: new Date(),
      }).returning();
      gameId = game.id;
    });

    res.json({ gameId });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whot/my-game
// ---------------------------------------------------------------------------
router.get("/whot/my-game", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const [game] = await db
      .select()
      .from(whotGamesTable)
      .where(
        and(
          sql`(player0_id = ${req.userId} OR player1_id = ${req.userId})`,
          eq(whotGamesTable.status, "active"),
        ),
      )
      .orderBy(whotGamesTable.startedAt)
      .limit(1);

    if (!game) { res.json({ game: null }); return; }
    const sanitised = sanitiseState(parseState(game.gameState), req.userId!, game.player0Id);
    res.json({ game: { ...game, gameState: sanitised } });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whot/games/:id
// ---------------------------------------------------------------------------
router.get("/whot/games/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const p0 = db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, whotGamesTable.player0Id)).as("p0");
    const p1 = db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, whotGamesTable.player1Id)).as("p1");

    const rows = await db
      .select({
        game: whotGamesTable,
        player0Username: sql<string>`(SELECT username FROM users WHERE id = ${whotGamesTable.player0Id})`,
        player1Username: sql<string>`(SELECT username FROM users WHERE id = ${whotGamesTable.player1Id})`,
      })
      .from(whotGamesTable)
      .where(eq(whotGamesTable.id, gameId))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ error: "Game not found" }); return; }

    const { game, player0Username, player1Username } = rows[0];
    if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
      res.status(403).json({ error: "Not a participant" }); return;
    }

    // Hide opponent's hand and deck contents from the requesting player
    const state = parseState(game.gameState);
    const sanitisedState = sanitiseState(state, req.userId!, game.player0Id);

    res.json({
      ...game,
      gameState: sanitisedState,
      player0Username,
      player1Username,
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/games/:id/play — play a card
// ---------------------------------------------------------------------------
router.post("/whot/games/:id/play", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { cardIndex, calledSuit } = req.body as { cardIndex?: unknown; calledSuit?: unknown };
    const idx = Number(cardIndex);
    if (Number.isNaN(idx) || idx < 0) { res.status(400).json({ error: "Invalid cardIndex" }); return; }

    let newState: GameState | null = null;
    let botTriggered = false;
    let p0Id = 0, p1Id = 0;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(whotGamesTable)
        .where(eq(whotGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      p0Id = game.player0Id; p1Id = game.player1Id;

      const state = parseState(game.gameState);
      const myIndex: 0 | 1 = game.player0Id === req.userId ? 0 : 1;

      if (state.currentTurn !== myIndex) throw Object.assign(new Error("Not your turn"), { status: 409 });

      const validSuit = typeof calledSuit === "string" ? calledSuit as Suit : null;
      newState = applyPlay(state, myIndex, idx, validSuit);

      const now = new Date();
      const updates: Partial<typeof whotGamesTable.$inferSelect> = {
        gameState: newState as unknown as Record<string, unknown>,
        lastMoveAt: now,
      };

      if (newState.status === "completed") {
        updates.status = "completed";
        updates.winnerId = newState.winnerId;
        updates.endedAt = now;
      }

      await tx.update(whotGamesTable).set(updates).where(eq(whotGamesTable.id, gameId));

      await tx.insert(whotMovesTable).values({
        gameId,
        playerId: req.userId!,
        action: "play",
        cardPlayed: state.players[myIndex].hand[idx] as unknown as Record<string, unknown>,
        calledSuit: validSuit ?? null,
        drewCount: 0,
      });

      if (newState.status === "completed") {
        const systemUserId = await getSystemUserId();
        const { platformFeePct } = await getWhotSettings();
        if (newState.winnerId === systemUserId) {
          await tx.insert(transactionsTable).values({
            userId: systemUserId, type: "whot_fee", amount: game.entryFee, status: "completed",
            description: `WHOT solo — bot win, platform retains ${game.entryFee} coins`,
          });
        } else {
          await payoutWinner(tx, systemUserId, newState.winnerId!, game.entryFee, platformFeePct / 100);
        }
      }

      const systemUserId = await getSystemUserId();
      botTriggered = (
        newState.status === "active" &&
        game.player1Id === systemUserId &&
        newState.currentTurn === 1
      );
    });

    emitGameUpdate(gameId, "play", newState!, p0Id, p1Id);
    if (botTriggered) {
      await new Promise(r => setTimeout(r, 700));
      triggerBotMove(gameId);
    }
    res.json({ state: sanitiseState(newState!, req.userId!, p0Id) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/games/:id/draw — draw a card
// ---------------------------------------------------------------------------
router.post("/whot/games/:id/draw", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let newState: GameState | null = null;
    let botTriggered = false;
    let p0Id = 0, p1Id = 0;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(whotGamesTable)
        .where(eq(whotGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      p0Id = game.player0Id; p1Id = game.player1Id;

      const state = parseState(game.gameState);
      const myIndex: 0 | 1 = game.player0Id === req.userId ? 0 : 1;

      if (state.currentTurn !== myIndex) throw Object.assign(new Error("Not your turn"), { status: 409 });

      // Server-side enforcement: draw only when no playable card (unless resolving pending pick)
      if (state.pendingPickCount === 0) {
        const playable = getPlayableCards(state, myIndex);
        if (playable.length > 0) {
          throw Object.assign(new Error("You have playable cards — you must play one"), { status: 400 });
        }
      }

      newState = applyDraw(state, myIndex);

      const now = new Date();
      await tx.update(whotGamesTable).set({
        gameState: newState as unknown as Record<string, unknown>,
        lastMoveAt: now,
      }).where(eq(whotGamesTable.id, gameId));

      const drewCount = state.pendingPickCount || 1;
      await tx.insert(whotMovesTable).values({
        gameId,
        playerId: req.userId!,
        action: "draw",
        drewCount,
      });

      const systemUserId = await getSystemUserId();
      botTriggered = (
        newState.status === "active" &&
        game.player1Id === systemUserId &&
        newState.currentTurn === 1
      );
    });

    emitGameUpdate(gameId, "draw", newState!, p0Id, p1Id);
    if (botTriggered) {
      await new Promise(r => setTimeout(r, 700));
      triggerBotMove(gameId);
    }
    res.json({ state: sanitiseState(newState!, req.userId!, p0Id) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/games/:id/call-suit — call a suit after WHOT (if missed)
// ---------------------------------------------------------------------------
router.post("/whot/games/:id/call-suit", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    const VALID_SUITS = ["Circle", "Triangle", "Cross", "Square", "Star"] as const;
    type ValidSuit = typeof VALID_SUITS[number];
    const { suit } = req.body as { suit?: unknown };
    if (!suit || typeof suit !== "string" || !(VALID_SUITS as readonly string[]).includes(suit)) {
      res.status(400).json({ error: "suit must be one of: Circle, Triangle, Cross, Square, Star" });
      return;
    }
    const validatedSuit = suit as ValidSuit;

    let newState: GameState | null = null;
    let p0Id = 0, p1Id = 0;

    await db.transaction(async tx => {
      const [game] = await tx.select().from(whotGamesTable).where(eq(whotGamesTable.id, gameId)).for("update").limit(1);
      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game not active"), { status: 409 });
      if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      p0Id = game.player0Id; p1Id = game.player1Id;

      const state = parseState(game.gameState);
      const myIndex: 0 | 1 = game.player0Id === req.userId ? 0 : 1;
      if (state.currentTurn !== myIndex) throw Object.assign(new Error("Not your turn"), { status: 409 });

      const top = state.discardPile[state.discardPile.length - 1];
      if (top.suit !== "WHOT" || state.calledSuit) throw Object.assign(new Error("No suit call needed"), { status: 409 });

      newState = { ...state, calledSuit: validatedSuit as Suit };
      await tx.update(whotGamesTable).set({ gameState: newState as unknown as Record<string, unknown> }).where(eq(whotGamesTable.id, gameId));
    });

    emitGameUpdate(gameId, "suit_called", newState!, p0Id, p1Id, { suit: validatedSuit });
    res.json({ state: sanitiseState(newState!, req.userId!, p0Id) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/games/:id/forfeit
// ---------------------------------------------------------------------------
router.post("/whot/games/:id/forfeit", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let newState: GameState | null = null;
    let p0Id = 0, p1Id = 0;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(whotGamesTable)
        .where(eq(whotGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      const state = parseState(game.gameState);
      newState = forfeit(state, req.userId!);
      const winnerId = newState.winnerId!;
      const now = new Date();

      await tx.update(whotGamesTable).set({
        gameState: newState as unknown as Record<string, unknown>,
        status: "completed",
        winnerId,
        endedAt: now,
      }).where(eq(whotGamesTable.id, gameId));

      p0Id = game.player0Id; p1Id = game.player1Id;

      const systemUserId = await getSystemUserId();
      const { platformFeePct } = await getWhotSettings();
      if (winnerId === systemUserId) {
        await tx.insert(transactionsTable).values({
          userId: systemUserId, type: "whot_fee", amount: game.entryFee, status: "completed",
          description: `WHOT solo — bot win (forfeit), platform retains ${game.entryFee} coins`,
        });
      } else {
        await payoutWinner(tx, systemUserId, winnerId, game.entryFee, platformFeePct / 100);
      }
    });

    emitGameUpdate(gameId, "forfeit", newState!, p0Id, p1Id, { winner: newState!.winnerId });
    res.json({ message: "Forfeited", state: sanitiseState(newState!, req.userId!, p0Id) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/whot/games/:id/claim-timeout
// ---------------------------------------------------------------------------
router.post("/whot/games/:id/claim-timeout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    let newState: GameState | null = null;
    let p0Id = 0, p1Id = 0;

    await db.transaction(async tx => {
      const [game] = await tx
        .select()
        .from(whotGamesTable)
        .where(eq(whotGamesTable.id, gameId))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });
      if (game.player0Id !== req.userId && game.player1Id !== req.userId) {
        throw Object.assign(new Error("Not a participant"), { status: 403 });
      }

      p0Id = game.player0Id; p1Id = game.player1Id;

      const state = parseState(game.gameState);
      const myIndex: 0 | 1 = game.player0Id === req.userId ? 0 : 1;

      if (state.currentTurn === myIndex) {
        throw Object.assign(new Error("It is your turn — opponent has not timed out"), { status: 400 });
      }

      const { timeoutMinutes, platformFeePct } = await getWhotSettings();
      if (!isTimedOut(state, timeoutMinutes * 60 * 1000)) {
        throw Object.assign(new Error("Opponent has not timed out yet"), { status: 400 });
      }

      const opponentId = myIndex === 0 ? game.player1Id : game.player0Id;
      newState = forfeit(state, opponentId);
      const now = new Date();

      await tx.update(whotGamesTable).set({
        gameState: newState as unknown as Record<string, unknown>,
        status: "completed",
        winnerId: req.userId,
        endedAt: now,
      }).where(eq(whotGamesTable.id, gameId));

      const systemUserId = await getSystemUserId();
      await payoutWinner(tx, systemUserId, req.userId!, game.entryFee, platformFeePct / 100);
    });

    emitGameUpdate(gameId, "timeout", newState!, p0Id, p1Id, { winner: req.userId });
    res.json({ message: "Won by timeout", state: sanitiseState(newState!, req.userId!, p0Id) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/whot/games/:id/events — SSE (auth via ?token= query param like Ludo)
// EventSource cannot send custom headers, so token is accepted as a query param.
// ---------------------------------------------------------------------------
router.get("/whot/games/:id/events", async (req: Request, res: Response): Promise<void> => {
  // Promote query-param token to Authorization header so verifyToken can read it
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token as string}`;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { verifyToken } = await import("../lib/auth");
  const uid = verifyToken(authHeader.replace("Bearer ", ""));
  if (!uid) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  req.userId = uid;

  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [game] = await db.select().from(whotGamesTable).where(eq(whotGamesTable.id, gameId)).limit(1);
  if (!game) { res.status(404).json({ error: "Game not found" }); return; }
  if (game.player0Id !== uid && game.player1Id !== uid) {
    res.status(403).json({ error: "Not a participant" }); return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: string) => { res.write(`data: ${data}\n\n`); };

  send(JSON.stringify({ type: "connected", gameId }));

  const remove = addSseListener(gameId, uid, send);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    remove();
    clearInterval(heartbeat);
  });
});

// ---------------------------------------------------------------------------
// Abandoned-game sweep — auto-forfeit games that have timed out with no claim
// ---------------------------------------------------------------------------
setInterval(async () => {
  try {
    const { timeoutMinutes, platformFeePct } = await getWhotSettings();
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const staleGames = await db
      .select()
      .from(whotGamesTable)
      .where(and(eq(whotGamesTable.status, "active"), sql`last_move_at < ${cutoff}`));

    for (const game of staleGames) {
      try {
        const state = parseState(game.gameState);
        const timedOutPlayerIndex = state.currentTurn as 0 | 1;
        const timedOutPlayerId = timedOutPlayerIndex === 0 ? game.player0Id : game.player1Id;
        const winnerId = timedOutPlayerIndex === 0 ? game.player1Id : game.player0Id;

        const newState = forfeit(state, timedOutPlayerId);
        const systemUserId = await getSystemUserId();

        await db.transaction(async tx => {
          const [current] = await tx.select({ status: whotGamesTable.status }).from(whotGamesTable).where(eq(whotGamesTable.id, game.id)).for("update").limit(1);
          if (!current || current.status !== "active") return;

          await tx.update(whotGamesTable).set({
            gameState: newState as unknown as Record<string, unknown>,
            status: "completed",
            winnerId,
            endedAt: new Date(),
          }).where(eq(whotGamesTable.id, game.id));

          if (winnerId === systemUserId) {
            await tx.insert(transactionsTable).values({
              userId: systemUserId, type: "whot_fee", amount: game.entryFee, status: "completed",
              description: `WHOT sweep — bot win, platform retains ${game.entryFee} coins`,
            });
          } else {
            await payoutWinner(tx, systemUserId, winnerId, game.entryFee, platformFeePct / 100);
          }
        });

        emitGameUpdate(game.id, "timeout", newState, game.player0Id, game.player1Id, { winner: winnerId });
      } catch {
        // non-fatal — skip this game
      }
    }
  } catch {
    // non-fatal sweep error
  }
}, 60_000);

export default router;
