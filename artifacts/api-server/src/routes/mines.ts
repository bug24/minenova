import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, transactionsTable, minesGamesTable, adminConfigTable } from "@workspace/db";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Mines multiplier formula
// Uses the standard combinatorics approach: expected value per safe reveal.
// multiplier = product over k=0..revealed-1 of (totalTiles - mineCount - k) / (totalTiles - k)
// Then apply house edge factor (1 - feePct/100).
// ---------------------------------------------------------------------------
const TOTAL_TILES = 25;

export function calcMultiplier(mineCount: number, revealed: number, houseEdge: number): number {
  if (revealed === 0) return 1;
  let mult = 1;
  for (let k = 0; k < revealed; k++) {
    const safeTiles = TOTAL_TILES - mineCount - k;
    const remainingTiles = TOTAL_TILES - k;
    if (safeTiles <= 0 || remainingTiles <= 0) return mult;
    mult *= remainingTiles / safeTiles;
  }
  return parseFloat((mult * houseEdge).toFixed(4));
}

// ---------------------------------------------------------------------------
// System user (for house fee)
// ---------------------------------------------------------------------------
let _systemUserId: number | null = null;
async function getSystemUserId(): Promise<number> {
  if (_systemUserId !== null) return _systemUserId;
  try {
    await db.insert(usersTable).values({
      username: "__system__",
      email: "__system__@minenova.internal",
      passwordHash: "__no_login__",
      referralCode: "__SYSTEM__",
    }).onConflictDoNothing();
  } catch { /* ignore */ }
  const rows = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.username, "__system__")).limit(1);
  if (rows.length === 0) throw new Error("System user not found");
  _systemUserId = rows[0].id;
  return _systemUserId;
}

// ---------------------------------------------------------------------------
// Mines settings
// ---------------------------------------------------------------------------
async function getMinesSettings(): Promise<{ enabled: boolean; minBet: number; maxBet: number; feePct: number }> {
  const keys = ["mines_enabled", "mines_min_bet", "mines_max_bet", "mines_fee_pct"];
  const rows = await db.select().from(adminConfigTable)
    .where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return {
    enabled: (cfg["mines_enabled"] ?? "true") === "true",
    minBet: parseFloat(cfg["mines_min_bet"] ?? "10"),
    maxBet: parseFloat(cfg["mines_max_bet"] ?? "100000"),
    feePct: parseFloat(cfg["mines_fee_pct"] ?? "5"),
  };
}

function handleErr(err: unknown, res: Response): void {
  if (res.headersSent) return;
  const e = err as { status?: number; message?: string };
  res.status(e.status ?? 500).json({ error: e.message ?? "Internal server error" });
}

// ---------------------------------------------------------------------------
// GET /api/mines/settings
// ---------------------------------------------------------------------------
router.get("/mines/settings", async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await getMinesSettings();
    res.json(settings);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/mines/start — begin a new game
// ---------------------------------------------------------------------------
router.post("/mines/start", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { bet, mineCount } = req.body as { bet?: unknown; mineCount?: unknown };
    const betNum = Number(bet);
    const mines = Number(mineCount);

    if (!betNum || betNum <= 0) { res.status(400).json({ error: "bet must be a positive number" }); return; }
    if (!Number.isInteger(mines) || mines < 3 || mines > 24) {
      res.status(400).json({ error: "mineCount must be between 3 and 24" }); return;
    }

    const settings = await getMinesSettings();
    if (!settings.enabled) { res.status(403).json({ error: "Mines is currently disabled" }); return; }
    if (betNum < settings.minBet || betNum > settings.maxBet) {
      res.status(400).json({ error: `Bet must be between ${settings.minBet} and ${settings.maxBet} coins` }); return;
    }

    // Generate mine positions server-side (random shuffle)
    const positions = Array.from({ length: TOTAL_TILES }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const minePositions = positions.slice(0, mines);

    let gameId = 0;

    await db.transaction(async tx => {
      // Check for existing active game inside the transaction
      const existing = await tx.select({ id: minesGamesTable.id })
        .from(minesGamesTable)
        .where(and(eq(minesGamesTable.userId, req.userId!), eq(minesGamesTable.status, "active")))
        .limit(1);
      if (existing.length > 0) {
        throw Object.assign(new Error("You already have an active game. Cash out first."), { status: 409 });
      }

      const claimed = await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${betNum}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${betNum}`))
        .returning({ id: usersTable.id });

      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "mines_bet",
        amount: -betNum,
        status: "completed",
        description: `Mines wager (${mines} mines, ${betNum} coins)`,
      });

      const [game] = await tx.insert(minesGamesTable).values({
        userId: req.userId!,
        bet: betNum,
        mineCount: mines,
        minePositions: minePositions as unknown as Record<string, unknown>,
        revealedTiles: [] as unknown as Record<string, unknown>,
        status: "active",
        currentMultiplier: 1,
      }).returning();

      gameId = game.id;
    });

    res.status(201).json({ gameId, bet: betNum, mineCount: mines, totalTiles: TOTAL_TILES });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/mines/reveal — reveal a tile
// SELECT FOR UPDATE prevents race conditions / double payouts on concurrent requests.
// ---------------------------------------------------------------------------
router.post("/mines/reveal", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { gameId, tileIndex } = req.body as { gameId?: unknown; tileIndex?: unknown };
    const gid = Number(gameId);
    const tile = Number(tileIndex);

    if (!Number.isInteger(gid) || gid <= 0) { res.status(400).json({ error: "Invalid gameId" }); return; }
    if (!Number.isInteger(tile) || tile < 0 || tile >= TOTAL_TILES) {
      res.status(400).json({ error: `tileIndex must be 0–${TOTAL_TILES - 1}` }); return;
    }

    // Load settings outside transaction (read-only, no race risk)
    const { feePct } = await getMinesSettings();
    const houseEdge = 1 - feePct / 100;

    let responsePayload: object = {};

    await db.transaction(async tx => {
      // Lock the row to prevent concurrent reveals / cashouts on the same game
      const [game] = await tx
        .select()
        .from(minesGamesTable)
        .where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.userId, req.userId!)))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });

      const minePositions = game.minePositions as number[];
      const revealedTiles = (game.revealedTiles as number[]) ?? [];

      if (revealedTiles.includes(tile)) throw Object.assign(new Error("Tile already revealed"), { status: 400 });

      const isMine = minePositions.includes(tile);
      const newRevealed = [...revealedTiles, tile];
      const newMultiplier = calcMultiplier(game.mineCount, newRevealed.length, houseEdge);
      const safeTilesLeft = TOTAL_TILES - game.mineCount - newRevealed.length;

      if (isMine) {
        // Lost — mark game over, no payout
        await tx.update(minesGamesTable).set({
          status: "lost",
          revealedTiles: newRevealed as unknown as Record<string, unknown>,
          currentMultiplier: 0,
          endedAt: new Date(),
        }).where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.status, "active")));

        responsePayload = {
          result: "mine",
          tileIndex: tile,
          minePositions,
          revealedTiles: newRevealed,
          multiplier: 0,
          payout: 0,
          status: "lost",
        };
      } else {
        const autoWin = safeTilesLeft === 0;

        if (autoWin) {
          // All safe tiles revealed — auto cash out
          const systemUserId = await getSystemUserId();
          const payout = parseFloat((game.bet * newMultiplier).toFixed(2));
          const fee = parseFloat((payout * feePct / 100).toFixed(2));

          await tx.update(minesGamesTable).set({
            status: "won",
            revealedTiles: newRevealed as unknown as Record<string, unknown>,
            currentMultiplier: newMultiplier,
            finalPayout: payout,
            endedAt: new Date(),
          }).where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.status, "active")));

          await tx.update(usersTable)
            .set({ coinBalance: sql`coin_balance + ${payout}` })
            .where(eq(usersTable.id, req.userId!));

          await tx.insert(transactionsTable).values({
            userId: req.userId!,
            type: "mines_win",
            amount: payout,
            status: "completed",
            description: `Mines win — ${newMultiplier.toFixed(2)}x on ${game.bet} coins`,
          });

          if (fee > 0) {
            await tx.update(usersTable)
              .set({ coinBalance: sql`coin_balance + ${fee}` })
              .where(eq(usersTable.id, systemUserId));
            await tx.insert(transactionsTable).values({
              userId: systemUserId,
              type: "mines_fee",
              amount: fee,
              status: "completed",
              description: `Mines house fee (${feePct}%)`,
            });
          }

          responsePayload = {
            result: "gem",
            tileIndex: tile,
            revealedTiles: newRevealed,
            multiplier: newMultiplier,
            payout,
            status: "won",
            autoWin: true,
            minePositions,
          };
        } else {
          await tx.update(minesGamesTable).set({
            revealedTiles: newRevealed as unknown as Record<string, unknown>,
            currentMultiplier: newMultiplier,
          }).where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.status, "active")));

          responsePayload = {
            result: "gem",
            tileIndex: tile,
            revealedTiles: newRevealed,
            multiplier: newMultiplier,
            potentialPayout: parseFloat((game.bet * newMultiplier).toFixed(2)),
            status: "active",
            safeTilesLeft,
          };
        }
      }
    });

    res.json(responsePayload);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/mines/cashout — cash out current game
// SELECT FOR UPDATE prevents duplicate payouts from concurrent cashout calls.
// ---------------------------------------------------------------------------
router.post("/mines/cashout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { gameId } = req.body as { gameId?: unknown };
    const gid = Number(gameId);
    if (!Number.isInteger(gid) || gid <= 0) { res.status(400).json({ error: "Invalid gameId" }); return; }

    // Load settings outside transaction (read-only)
    const { feePct } = await getMinesSettings();

    let responsePayload: object = {};

    await db.transaction(async tx => {
      // Lock the row to prevent concurrent cashout + reveal race
      const [game] = await tx
        .select()
        .from(minesGamesTable)
        .where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.userId, req.userId!)))
        .for("update")
        .limit(1);

      if (!game) throw Object.assign(new Error("Game not found"), { status: 404 });
      if (game.status !== "active") throw Object.assign(new Error("Game is not active"), { status: 409 });

      const revealedTiles = (game.revealedTiles as number[]) ?? [];
      if (revealedTiles.length < 2) {
        throw Object.assign(new Error("Reveal at least 2 gems before cashing out"), { status: 400 });
      }

      const systemUserId = await getSystemUserId();
      const payout = parseFloat((game.bet * game.currentMultiplier).toFixed(2));
      const fee = parseFloat((payout * feePct / 100).toFixed(2));
      const minePositions = game.minePositions as number[];

      // Update with status guard — if already changed by a concurrent request, affected rows = 0
      const updated = await tx.update(minesGamesTable).set({
        status: "won",
        finalPayout: payout,
        endedAt: new Date(),
      }).where(and(eq(minesGamesTable.id, gid), eq(minesGamesTable.status, "active")))
        .returning({ id: minesGamesTable.id });

      if (updated.length === 0) throw Object.assign(new Error("Game is not active"), { status: 409 });

      await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${payout}` })
        .where(eq(usersTable.id, req.userId!));

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "mines_win",
        amount: payout,
        status: "completed",
        description: `Mines cashout — ${game.currentMultiplier.toFixed(2)}x on ${game.bet} coins`,
      });

      if (fee > 0) {
        await tx.update(usersTable)
          .set({ coinBalance: sql`coin_balance + ${fee}` })
          .where(eq(usersTable.id, systemUserId));
        await tx.insert(transactionsTable).values({
          userId: systemUserId,
          type: "mines_fee",
          amount: fee,
          status: "completed",
          description: `Mines house fee (${feePct}%)`,
        });
      }

      responsePayload = {
        payout,
        multiplier: game.currentMultiplier,
        minePositions,
        status: "won",
      };
    });

    res.json(responsePayload);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/mines/active — get current user's active game (if any)
// ---------------------------------------------------------------------------
router.get("/mines/active", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const [game] = await db.select().from(minesGamesTable)
      .where(and(eq(minesGamesTable.userId, req.userId!), eq(minesGamesTable.status, "active")))
      .limit(1);

    if (!game) { res.json({ game: null }); return; }

    res.json({
      game: {
        id: game.id,
        bet: game.bet,
        mineCount: game.mineCount,
        revealedTiles: game.revealedTiles as number[],
        currentMultiplier: game.currentMultiplier,
        potentialPayout: parseFloat((game.bet * game.currentMultiplier).toFixed(2)),
        status: game.status,
      },
    });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/mines/history — last 10 games
// ---------------------------------------------------------------------------
router.get("/mines/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const games = await db.select({
      id: minesGamesTable.id,
      bet: minesGamesTable.bet,
      mineCount: minesGamesTable.mineCount,
      status: minesGamesTable.status,
      currentMultiplier: minesGamesTable.currentMultiplier,
      finalPayout: minesGamesTable.finalPayout,
      revealedCount: sql<number>`jsonb_array_length(revealed_tiles)`,
      startedAt: minesGamesTable.startedAt,
    }).from(minesGamesTable)
      .where(eq(minesGamesTable.userId, req.userId!))
      .orderBy(desc(minesGamesTable.startedAt))
      .limit(10);

    res.json(games.map(g => ({
      ...g,
      profit: g.status === "won"
        ? parseFloat(((g.finalPayout ?? 0) - g.bet).toFixed(2))
        : -g.bet,
    })));
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/mines/leaderboard — top wins today + all time (public)
// ---------------------------------------------------------------------------
router.get("/mines/leaderboard", async (_req: Request, res: Response): Promise<void> => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const baseSelect = {
      id: minesGamesTable.id,
      username: usersTable.username,
      mineCount: minesGamesTable.mineCount,
      multiplier: minesGamesTable.currentMultiplier,
      payout: minesGamesTable.finalPayout,
      bet: minesGamesTable.bet,
      endedAt: minesGamesTable.endedAt,
    };

    const wonToday = and(eq(minesGamesTable.status, "won"), gte(minesGamesTable.endedAt, todayStart));
    const wonAllTime = eq(minesGamesTable.status, "won");

    const [
      todayByPayout, allTimeByPayout,
      todayByMultiplier, allTimeByMultiplier,
    ] = await Promise.all([
      db.select(baseSelect).from(minesGamesTable)
        .innerJoin(usersTable, eq(minesGamesTable.userId, usersTable.id))
        .where(wonToday).orderBy(desc(minesGamesTable.finalPayout)).limit(10),
      db.select(baseSelect).from(minesGamesTable)
        .innerJoin(usersTable, eq(minesGamesTable.userId, usersTable.id))
        .where(wonAllTime).orderBy(desc(minesGamesTable.finalPayout)).limit(10),
      db.select(baseSelect).from(minesGamesTable)
        .innerJoin(usersTable, eq(minesGamesTable.userId, usersTable.id))
        .where(wonToday).orderBy(desc(minesGamesTable.currentMultiplier)).limit(10),
      db.select(baseSelect).from(minesGamesTable)
        .innerJoin(usersTable, eq(minesGamesTable.userId, usersTable.id))
        .where(wonAllTime).orderBy(desc(minesGamesTable.currentMultiplier)).limit(10),
    ]);

    const fmt = (rows: typeof todayByPayout) => rows.map((r, idx) => ({
      id: r.id,
      rank: idx + 1,
      username: r.username,
      mineCount: r.mineCount,
      multiplier: r.multiplier,
      payout: r.payout ?? 0,
      bet: r.bet,
      profit: parseFloat(((r.payout ?? 0) - r.bet).toFixed(2)),
      endedAt: r.endedAt,
    }));

    res.json({
      today: { byPayout: fmt(todayByPayout), byMultiplier: fmt(todayByMultiplier) },
      allTime: { byPayout: fmt(allTimeByPayout), byMultiplier: fmt(allTimeByMultiplier) },
    });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/mines/streak — current user's consecutive profitable sessions
// ---------------------------------------------------------------------------
router.get("/mines/streak", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const games = await db.select({
      status: minesGamesTable.status,
      bet: minesGamesTable.bet,
      finalPayout: minesGamesTable.finalPayout,
    }).from(minesGamesTable)
      .where(and(
        eq(minesGamesTable.userId, req.userId!),
        sql`status IN ('won', 'lost')`,
      ))
      .orderBy(desc(minesGamesTable.endedAt))
      .limit(100);

    let streak = 0;
    for (const g of games) {
      const profitable = g.status === "won" && (g.finalPayout ?? 0) > g.bet;
      if (profitable) {
        streak++;
      } else {
        break;
      }
    }

    res.json({ streak });
  } catch (err) { handleErr(err, res); }
});

export default router;
