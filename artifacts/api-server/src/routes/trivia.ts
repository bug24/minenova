import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, usersTable, transactionsTable, adminConfigTable,
  triviaQuestionsTable, triviaGamesTable, triviaChallengesTable,
} from "@workspace/db";
import { eq, desc, sql, and, ne, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// SSE registry
// ---------------------------------------------------------------------------
type Listener = (data: string) => void;
const sseListeners = new Map<number, Set<Listener>>();

function emitTriviaUpdate(gameId: number, payload: object): void {
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
// System user
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
// Trivia settings
// ---------------------------------------------------------------------------
async function getTriviaSettings(): Promise<{ enabled: boolean; minFee: number; maxFee: number; feePct: number }> {
  const keys = ["trivia_enabled", "trivia_min_fee", "trivia_max_fee", "trivia_fee_pct"];
  const rows = await db.select().from(adminConfigTable)
    .where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return {
    enabled: (cfg["trivia_enabled"] ?? "true") === "true",
    minFee: parseFloat(cfg["trivia_min_fee"] ?? "50"),
    maxFee: parseFloat(cfg["trivia_max_fee"] ?? "50000"),
    feePct: parseFloat(cfg["trivia_fee_pct"] ?? "5"),
  };
}

function handleErr(err: unknown, res: Response): void {
  if (res.headersSent) return;
  const e = err as { status?: number; message?: string };
  res.status(e.status ?? 500).json({ error: e.message ?? "Internal server error" });
}

// ---------------------------------------------------------------------------
// Seed 40+ crypto questions (idempotent)
// ---------------------------------------------------------------------------
export async function seedTriviaQuestions(): Promise<void> {
  const count = await db.select({ n: sql<number>`count(*)` }).from(triviaQuestionsTable);
  if (Number(count[0].n) > 0) return;

  const questions: Array<{ question: string; options: string[]; correctIndex: number; category: string; difficulty: string }> = [
    // Bitcoin (8)
    { question: "Who created Bitcoin?", options: ["Vitalik Buterin", "Satoshi Nakamoto", "Charlie Lee", "Gavin Andresen"], correctIndex: 1, category: "Bitcoin", difficulty: "easy" },
    { question: "What is Bitcoin's maximum supply?", options: ["100 million", "21 million", "50 million", "Unlimited"], correctIndex: 1, category: "Bitcoin", difficulty: "easy" },
    { question: "In what year was Bitcoin launched?", options: ["2007", "2009", "2011", "2013"], correctIndex: 1, category: "Bitcoin", difficulty: "easy" },
    { question: "What is the name of Bitcoin's smallest unit?", options: ["Wei", "Satoshi", "Gwei", "Bit"], correctIndex: 1, category: "Bitcoin", difficulty: "medium" },
    { question: "How many satoshis make one Bitcoin?", options: ["10,000", "1,000,000", "100,000,000", "1,000,000,000"], correctIndex: 2, category: "Bitcoin", difficulty: "medium" },
    { question: "What consensus mechanism does Bitcoin use?", options: ["Proof of Stake", "Delegated PoS", "Proof of Work", "Proof of Authority"], correctIndex: 2, category: "Bitcoin", difficulty: "medium" },
    { question: "Approximately how often does Bitcoin halving occur?", options: ["Every year", "Every 2 years", "Every 4 years", "Every 10 years"], correctIndex: 2, category: "Bitcoin", difficulty: "medium" },
    { question: "What is the Bitcoin genesis block also known as?", options: ["Block Zero", "The Origin Block", "The Nakamoto Block", "Block 0"], correctIndex: 0, category: "Bitcoin", difficulty: "hard" },
    // Ethereum (8)
    { question: "Who is the co-founder and main developer of Ethereum?", options: ["Charles Hoskinson", "Gavin Wood", "Vitalik Buterin", "Joseph Lubin"], correctIndex: 2, category: "Ethereum", difficulty: "easy" },
    { question: "What is the name of Ethereum's native currency?", options: ["ETH", "ETC", "GAS", "GWEI"], correctIndex: 0, category: "Ethereum", difficulty: "easy" },
    { question: "What is the smallest unit of Ether called?", options: ["Satoshi", "Finney", "Wei", "Gwei"], correctIndex: 2, category: "Ethereum", difficulty: "medium" },
    { question: "What programming language is mainly used to write Ethereum smart contracts?", options: ["JavaScript", "Python", "Solidity", "Rust"], correctIndex: 2, category: "Ethereum", difficulty: "medium" },
    { question: "What was the Ethereum upgrade that switched from PoW to PoS?", options: ["Istanbul", "Berlin", "London", "The Merge"], correctIndex: 3, category: "Ethereum", difficulty: "medium" },
    { question: "What does EVM stand for in Ethereum?", options: ["Ethereum Value Machine", "Ethereum Virtual Machine", "Encrypted Virtual Memory", "Ethereum Validator Module"], correctIndex: 1, category: "Ethereum", difficulty: "medium" },
    { question: "What EIP introduced the ETH burning mechanism?", options: ["EIP-20", "EIP-721", "EIP-1559", "EIP-4844"], correctIndex: 2, category: "Ethereum", difficulty: "hard" },
    { question: "What is the name for Ethereum's execution layer client?", options: ["Prysm", "Geth", "Lighthouse", "Nimbus"], correctIndex: 1, category: "Ethereum", difficulty: "hard" },
    // DeFi (6)
    { question: "What does DeFi stand for?", options: ["Digital Finance", "Decentralized Finance", "Distributed Funds", "Derivative Finance"], correctIndex: 1, category: "DeFi", difficulty: "easy" },
    { question: "What is a liquidity pool?", options: ["A bank reserve", "A smart contract holding token pairs for trading", "A mining reward fund", "A staking wallet"], correctIndex: 1, category: "DeFi", difficulty: "medium" },
    { question: "What is impermanent loss in DeFi?", options: ["Permanent loss of funds", "Temporary value loss from price divergence in LP positions", "Gas fees spent on failed transactions", "Losses from rug pulls"], correctIndex: 1, category: "DeFi", difficulty: "hard" },
    { question: "Which protocol pioneered the Automated Market Maker (AMM) model?", options: ["Compound", "Aave", "Uniswap", "SushiSwap"], correctIndex: 2, category: "DeFi", difficulty: "medium" },
    { question: "What is a flash loan?", options: ["A very fast transaction", "An uncollateralized loan repaid within one block", "A loan with instant approval", "A micro-loan on Layer 2"], correctIndex: 1, category: "DeFi", difficulty: "hard" },
    { question: "Which token standard is most commonly used for DeFi tokens?", options: ["ERC-20", "ERC-721", "ERC-1155", "BEP-2"], correctIndex: 0, category: "DeFi", difficulty: "easy" },
    // Mining (6)
    { question: "What does a Bitcoin miner compete to solve?", options: ["A sudoku puzzle", "A cryptographic hash puzzle", "An RSA factoring problem", "A Merkle tree path"], correctIndex: 1, category: "Mining", difficulty: "medium" },
    { question: "What is a mining pool?", options: ["A water cooling system for rigs", "A group of miners combining hash power to earn more consistent rewards", "A cloud mining service", "A hardware rental marketplace"], correctIndex: 1, category: "Mining", difficulty: "easy" },
    { question: "What does hash rate measure in crypto mining?", options: ["Energy consumption", "Number of coins earned per day", "Computational power (hashes per second)", "Transaction confirmation speed"], correctIndex: 2, category: "Mining", difficulty: "medium" },
    { question: "What is the block reward for Bitcoin after the 2024 halving?", options: ["6.25 BTC", "3.125 BTC", "1.5625 BTC", "12.5 BTC"], correctIndex: 1, category: "Mining", difficulty: "hard" },
    { question: "What algorithm does Bitcoin use for its Proof of Work?", options: ["Ethash", "Scrypt", "SHA-256", "X11"], correctIndex: 2, category: "Mining", difficulty: "medium" },
    { question: "What is the 'difficulty adjustment' in Bitcoin mining?", options: ["Reducing block size", "Automatic recalibration to maintain 10-minute block times", "Changing the reward per block", "Updating node software"], correctIndex: 1, category: "Mining", difficulty: "medium" },
    // Altcoins (6)
    { question: "Which cryptocurrency uses the Scrypt algorithm?", options: ["Bitcoin", "Ethereum", "Litecoin", "Monero"], correctIndex: 2, category: "Altcoins", difficulty: "medium" },
    { question: "What is Cardano's native currency?", options: ["DOT", "ADA", "SOL", "ATOM"], correctIndex: 1, category: "Altcoins", difficulty: "easy" },
    { question: "Which blockchain is known for its high throughput and low fees, often called an 'Ethereum killer'?", options: ["Litecoin", "Dogecoin", "Solana", "Ripple"], correctIndex: 2, category: "Altcoins", difficulty: "easy" },
    { question: "What is Monero (XMR) primarily known for?", options: ["Smart contracts", "Privacy and anonymity", "Fast transactions", "Stablecoin pegging"], correctIndex: 1, category: "Altcoins", difficulty: "easy" },
    { question: "Litecoin was created as a fork of which cryptocurrency?", options: ["Ethereum", "Bitcoin Cash", "Bitcoin", "Dash"], correctIndex: 2, category: "Altcoins", difficulty: "easy" },
    { question: "What consensus mechanism does Cardano use?", options: ["Proof of Work", "Proof of Authority", "Ouroboros (PoS)", "Delegated PoS"], correctIndex: 2, category: "Altcoins", difficulty: "hard" },
    // Blockchain Basics (6)
    { question: "What is a blockchain?", options: ["A type of database with linked encrypted blocks", "A centralized ledger managed by banks", "A cloud storage system", "An internet protocol"], correctIndex: 0, category: "Blockchain Basics", difficulty: "easy" },
    { question: "What does a cryptographic hash function guarantee?", options: ["Reversibility", "Same output for same input (deterministic) and avalanche effect", "Variable output length", "Encryption of private data"], correctIndex: 1, category: "Blockchain Basics", difficulty: "medium" },
    { question: "What is a Merkle tree used for in a blockchain?", options: ["Mining coordination", "Efficient and secure verification of transaction data", "Generating wallet addresses", "Encrypting blocks"], correctIndex: 1, category: "Blockchain Basics", difficulty: "hard" },
    { question: "What does 'immutable' mean in the context of blockchain?", options: ["Data can be deleted by admins", "Records cannot be altered once written", "Blocks can be updated with new data", "Only validators can read data"], correctIndex: 1, category: "Blockchain Basics", difficulty: "easy" },
    { question: "What is a 51% attack?", options: ["Stealing 51% of coins from a wallet", "When one entity controls majority of network hash power to manipulate the chain", "A phishing attack on 51 nodes", "A smart contract vulnerability"], correctIndex: 1, category: "Blockchain Basics", difficulty: "medium" },
    { question: "What is a node in a blockchain network?", options: ["A validator with staked coins", "A computer that participates in maintaining the blockchain", "A hardware wallet", "A smart contract"], correctIndex: 1, category: "Blockchain Basics", difficulty: "easy" },
    // NFTs (4)
    { question: "What does NFT stand for?", options: ["New Financial Token", "Non-Fungible Token", "Network File Transfer", "Neutral Finance Token"], correctIndex: 1, category: "NFTs", difficulty: "easy" },
    { question: "Which token standard is most commonly used for NFTs on Ethereum?", options: ["ERC-20", "ERC-721", "ERC-1155", "ERC-4626"], correctIndex: 1, category: "NFTs", difficulty: "medium" },
    { question: "What makes an NFT 'non-fungible'?", options: ["It can be split into fractions", "Each token is unique and not interchangeable", "It has no monetary value", "It is backed by physical assets"], correctIndex: 1, category: "NFTs", difficulty: "easy" },
    { question: "What is the most expensive NFT collection by total sales volume historically?", options: ["Bored Ape Yacht Club", "Pudgy Penguins", "CryptoPunks", "Art Blocks"], correctIndex: 2, category: "NFTs", difficulty: "hard" },
    // Exchanges (4)
    { question: "What does CEX stand for in crypto?", options: ["Crypto Exchange", "Centralized Exchange", "Certified Exchange", "Chain Exchange"], correctIndex: 1, category: "Exchanges", difficulty: "easy" },
    { question: "What does DEX stand for?", options: ["Derivative Exchange", "Digital Exchange", "Decentralized Exchange", "Direct Exchange"], correctIndex: 2, category: "Exchanges", difficulty: "easy" },
    { question: "What is an order book in a crypto exchange?", options: ["A record of KYC documents", "A list of buy and sell orders at various prices", "A transaction history log", "A list of supported tokens"], correctIndex: 1, category: "Exchanges", difficulty: "medium" },
    { question: "Which exchange was the largest by volume before its collapse in 2022?", options: ["Binance", "Coinbase", "Kraken", "FTX"], correctIndex: 3, category: "Exchanges", difficulty: "medium" },
  ];

  await db.insert(triviaQuestionsTable).values(
    questions.map(q => ({
      question: q.question,
      options: q.options as unknown as Record<string, unknown>,
      correctIndex: q.correctIndex,
      category: q.category,
      difficulty: q.difficulty,
    }))
  );
}

// ---------------------------------------------------------------------------
// Settlement helper
// ---------------------------------------------------------------------------
async function settleGame(gameId: number): Promise<void> {
  const [game] = await db.select().from(triviaGamesTable)
    .where(eq(triviaGamesTable.id, gameId)).limit(1);
  if (!game || game.status !== "active") return;

  const p1Answers = game.player1Answers as (number | null)[];
  const p2Answers = game.player2Answers as (number | null)[];
  const questionIds = game.questionIds as number[];

  // Ensure both players have answered all questions
  if (p1Answers.length < questionIds.length) return;
  if (game.mode === "pvp" && p2Answers.length < questionIds.length) return;

  const questions = await db.select().from(triviaQuestionsTable)
    .where(inArray(triviaQuestionsTable.id, questionIds));
  const qMap = new Map(questions.map(q => [q.id, q.correctIndex]));

  let p1Score = 0;
  let p2Score = 0;
  for (let i = 0; i < questionIds.length; i++) {
    const correct = qMap.get(questionIds[i]);
    if (p1Answers[i] !== null && p1Answers[i] === correct) p1Score++;
    if (p2Answers[i] !== null && p2Answers[i] === correct) p2Score++;
  }

  const systemUserId = await getSystemUserId();
  const { feePct } = await getTriviaSettings();
  const pot = game.mode === "pvp" ? game.entryFee * 2 : game.entryFee * 2;
  const fee = parseFloat((pot * feePct / 100).toFixed(2));
  const winnings = parseFloat((pot - fee).toFixed(2));

  let winnerId: number | null = null;
  if (p1Score > p2Score) {
    winnerId = game.player1Id;
  } else if (p2Score > p1Score && game.player2Id) {
    winnerId = game.player2Id;
  }
  // tie: no winner, both refunded minus fee

  await db.transaction(async tx => {
    await tx.update(triviaGamesTable).set({
      status: "completed",
      player1Score: p1Score,
      player2Score: p2Score,
      winnerId,
      endedAt: new Date(),
    }).where(and(eq(triviaGamesTable.id, gameId), eq(triviaGamesTable.status, "active")));

    if (winnerId) {
      await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${winnings}` })
        .where(eq(usersTable.id, winnerId));
      await tx.insert(transactionsTable).values({
        userId: winnerId,
        type: "trivia_win",
        amount: winnings,
        status: "completed",
        description: `Trivia win — ${game.mode === "bot" ? "vs Bot" : "vs Player"} (${p1Score === p2Score ? "N/A" : winnerId === game.player1Id ? p1Score : p2Score}/10)`,
      });
    } else {
      // Tie — refund both (minus fee split equally)
      const refund = parseFloat((pot / 2 - fee / 2).toFixed(2));
      await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${refund}` })
        .where(eq(usersTable.id, game.player1Id));
      await tx.insert(transactionsTable).values({
        userId: game.player1Id,
        type: "trivia_refund",
        amount: refund,
        status: "completed",
        description: `Trivia tie refund`,
      });
      if (game.player2Id) {
        await tx.update(usersTable)
          .set({ coinBalance: sql`coin_balance + ${refund}` })
          .where(eq(usersTable.id, game.player2Id));
        await tx.insert(transactionsTable).values({
          userId: game.player2Id,
          type: "trivia_refund",
          amount: refund,
          status: "completed",
          description: `Trivia tie refund`,
        });
      }
    }

    if (fee > 0) {
      await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${fee}` })
        .where(eq(usersTable.id, systemUserId));
      await tx.insert(transactionsTable).values({
        userId: systemUserId,
        type: "trivia_fee",
        amount: fee,
        status: "completed",
        description: `Trivia platform fee (${feePct}%)`,
      });
    }
  });

  emitTriviaUpdate(gameId, { event: "game_over", gameId });
}

// ---------------------------------------------------------------------------
// GET /api/trivia/settings
// ---------------------------------------------------------------------------
router.get("/trivia/settings", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getTriviaSettings());
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/questions — public, omits correctIndex
// ---------------------------------------------------------------------------
router.get("/trivia/questions", async (_req: Request, res: Response): Promise<void> => {
  try {
    const questions = await db.select({
      id: triviaQuestionsTable.id,
      question: triviaQuestionsTable.question,
      options: triviaQuestionsTable.options,
      category: triviaQuestionsTable.category,
      difficulty: triviaQuestionsTable.difficulty,
    }).from(triviaQuestionsTable)
      .where(eq(triviaQuestionsTable.isActive, true));
    res.json(questions);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/trivia/solo — start a bot game
// ---------------------------------------------------------------------------
router.post("/trivia/solo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);

    if (!fee || fee <= 0) { res.status(400).json({ error: "entryFee must be a positive number" }); return; }

    const settings = await getTriviaSettings();
    if (!settings.enabled) { res.status(403).json({ error: "Trivia is currently disabled" }); return; }
    if (fee < settings.minFee || fee > settings.maxFee) {
      res.status(400).json({ error: `Entry fee must be between ${settings.minFee} and ${settings.maxFee} coins` }); return;
    }

    // Pick 10 random questions
    const allQ = await db.select({ id: triviaQuestionsTable.id })
      .from(triviaQuestionsTable).where(eq(triviaQuestionsTable.isActive, true));
    if (allQ.length < 10) { res.status(500).json({ error: "Not enough questions in database" }); return; }

    const shuffled = allQ.sort(() => Math.random() - 0.5).slice(0, 10);
    const questionIds = shuffled.map(q => q.id);

    // Bot answers at ~65% accuracy
    const allQWithAnswers = await db.select({
      id: triviaQuestionsTable.id,
      correctIndex: triviaQuestionsTable.correctIndex,
      options: triviaQuestionsTable.options,
    }).from(triviaQuestionsTable)
      .where(inArray(triviaQuestionsTable.id, questionIds));

    const botAnswers = allQWithAnswers.map(q => {
      const isCorrect = Math.random() < 0.65;
      if (isCorrect) return q.correctIndex;
      const opts = (q.options as string[]).length;
      const wrong = Array.from({ length: opts }, (_, i) => i).filter(i => i !== q.correctIndex);
      return wrong[Math.floor(Math.random() * wrong.length)] ?? 0;
    });

    let gameId = 0;

    await db.transaction(async tx => {
      const claimed = await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${fee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${fee}`))
        .returning({ id: usersTable.id });

      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "trivia_entry",
        amount: -fee,
        status: "completed",
        description: `Trivia entry fee (vs Bot, ${fee} coins)`,
      });

      const [game] = await tx.insert(triviaGamesTable).values({
        mode: "bot",
        status: "active",
        player1Id: req.userId!,
        player2Id: null,
        entryFee: fee,
        questionIds: questionIds as unknown as Record<string, unknown>,
        player1Answers: [] as unknown as Record<string, unknown>,
        player2Answers: botAnswers as unknown as Record<string, unknown>,
        player1Score: 0,
        player2Score: 0,
      }).returning();

      gameId = game.id;
    });

    res.status(201).json({ gameId, questionIds, mode: "bot" });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/challenges
// ---------------------------------------------------------------------------
router.get("/trivia/challenges", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const challenges = await db.select({
      id: triviaChallengesTable.id,
      creatorId: triviaChallengesTable.creatorId,
      creatorUsername: usersTable.username,
      entryFee: triviaChallengesTable.entryFee,
      status: triviaChallengesTable.status,
      createdAt: triviaChallengesTable.createdAt,
    }).from(triviaChallengesTable)
      .leftJoin(usersTable, eq(usersTable.id, triviaChallengesTable.creatorId))
      .where(eq(triviaChallengesTable.status, "open"))
      .orderBy(triviaChallengesTable.createdAt);
    res.json(challenges);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/trivia/challenges — create a PvP challenge
// ---------------------------------------------------------------------------
router.post("/trivia/challenges", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryFee } = req.body as { entryFee?: unknown };
    const fee = Number(entryFee);
    if (!fee || fee <= 0) { res.status(400).json({ error: "entryFee must be a positive number" }); return; }

    const settings = await getTriviaSettings();
    if (!settings.enabled) { res.status(403).json({ error: "Trivia is currently disabled" }); return; }
    if (fee < settings.minFee || fee > settings.maxFee) {
      res.status(400).json({ error: `Entry fee must be between ${settings.minFee} and ${settings.maxFee} coins` }); return;
    }

    let challengeId = 0;
    await db.transaction(async tx => {
      const claimed = await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${fee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${fee}`))
        .returning({ id: usersTable.id });
      if (claimed.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "trivia_entry",
        amount: -fee,
        status: "completed",
        description: `Trivia entry fee held (${fee} coins)`,
      });

      const [challenge] = await tx.insert(triviaChallengesTable).values({
        creatorId: req.userId!,
        entryFee: fee,
        status: "open",
      }).returning();
      challengeId = challenge.id;
    });

    res.status(201).json({ id: challengeId, entryFee: fee, status: "open" });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/trivia/challenges/:id/accept
// ---------------------------------------------------------------------------
router.post("/trivia/challenges/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [challenge] = await db.select().from(triviaChallengesTable)
      .where(eq(triviaChallengesTable.id, challengeId)).limit(1);
    if (!challenge) { res.status(404).json({ error: "Challenge not found" }); return; }
    if (challenge.status !== "open") { res.status(409).json({ error: "Challenge is no longer open" }); return; }
    if (challenge.creatorId === req.userId) { res.status(400).json({ error: "Cannot accept your own challenge" }); return; }

    // Pick 10 random questions
    const allQ = await db.select({ id: triviaQuestionsTable.id })
      .from(triviaQuestionsTable).where(eq(triviaQuestionsTable.isActive, true));
    if (allQ.length < 10) { res.status(500).json({ error: "Not enough questions" }); return; }
    const questionIds = allQ.sort(() => Math.random() - 0.5).slice(0, 10).map(q => q.id);

    let gameId = 0;
    await db.transaction(async tx => {
      const claimed = await tx.update(triviaChallengesTable)
        .set({ status: "matched" })
        .where(and(eq(triviaChallengesTable.id, challengeId), eq(triviaChallengesTable.status, "open")))
        .returning({ id: triviaChallengesTable.id, entryFee: triviaChallengesTable.entryFee, creatorId: triviaChallengesTable.creatorId });
      if (claimed.length === 0) throw Object.assign(new Error("Challenge no longer open"), { status: 409 });

      const { entryFee, creatorId } = claimed[0];
      const deducted = await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance - ${entryFee}` })
        .where(and(eq(usersTable.id, req.userId!), sql`coin_balance >= ${entryFee}`))
        .returning({ id: usersTable.id });
      if (deducted.length === 0) throw Object.assign(new Error("Insufficient coin balance"), { status: 400 });

      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "trivia_entry",
        amount: -entryFee,
        status: "completed",
        description: `Trivia entry fee held (${entryFee} coins)`,
      });

      const [game] = await tx.insert(triviaGamesTable).values({
        mode: "pvp",
        status: "active",
        player1Id: creatorId,
        player2Id: req.userId!,
        challengeId,
        entryFee,
        questionIds: questionIds as unknown as Record<string, unknown>,
        player1Answers: [] as unknown as Record<string, unknown>,
        player2Answers: [] as unknown as Record<string, unknown>,
        player1Score: 0,
        player2Score: 0,
      }).returning();
      gameId = game.id;
    });

    res.status(201).json({ gameId, questionIds, mode: "pvp" });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// DELETE /api/trivia/challenges/:id — cancel own open challenge
// ---------------------------------------------------------------------------
router.delete("/trivia/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.transaction(async tx => {
      const cancelled = await tx.update(triviaChallengesTable)
        .set({ status: "cancelled" })
        .where(and(eq(triviaChallengesTable.id, challengeId), eq(triviaChallengesTable.creatorId, req.userId!), eq(triviaChallengesTable.status, "open")))
        .returning({ entryFee: triviaChallengesTable.entryFee });
      if (cancelled.length === 0) throw Object.assign(new Error("Cannot cancel this challenge"), { status: 409 });

      await tx.update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${cancelled[0].entryFee}` })
        .where(eq(usersTable.id, req.userId!));
      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "trivia_refund",
        amount: cancelled[0].entryFee,
        status: "completed",
        description: `Trivia challenge cancelled — entry fee refunded`,
      });
    });
    res.json({ message: "Challenge cancelled and coins refunded" });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// POST /api/trivia/answer
// ---------------------------------------------------------------------------
router.post("/trivia/answer", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { gameId, questionIndex, answerIndex } = req.body as { gameId?: unknown; questionIndex?: unknown; answerIndex?: unknown };
    const gid = Number(gameId);
    const qIdx = Number(questionIndex);
    const aIdx = answerIndex === null ? null : Number(answerIndex);

    if (!Number.isInteger(gid) || gid <= 0) { res.status(400).json({ error: "Invalid gameId" }); return; }
    if (!Number.isInteger(qIdx) || qIdx < 0 || qIdx > 9) { res.status(400).json({ error: "Invalid questionIndex (0-9)" }); return; }

    const [game] = await db.select().from(triviaGamesTable)
      .where(eq(triviaGamesTable.id, gid)).limit(1);
    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    if (game.status !== "active") { res.status(409).json({ error: "Game is not active" }); return; }

    const isP1 = game.player1Id === req.userId;
    const isP2 = game.player2Id === req.userId;
    if (!isP1 && !isP2) { res.status(403).json({ error: "Not a participant" }); return; }

    const questionIds = game.questionIds as number[];
    if (qIdx >= questionIds.length) { res.status(400).json({ error: "Question index out of range" }); return; }

    const currentAnswers = (isP1 ? game.player1Answers : game.player2Answers) as (number | null)[];
    if (currentAnswers.length > qIdx) { res.status(409).json({ error: "Already answered this question" }); return; }

    // Append answer (must be sequential)
    if (currentAnswers.length !== qIdx) { res.status(400).json({ error: "Answer questions in order" }); return; }
    const newAnswers = [...currentAnswers, aIdx];

    const updateField = isP1 ? { player1Answers: newAnswers as unknown as Record<string, unknown> } : { player2Answers: newAnswers as unknown as Record<string, unknown> };
    await db.update(triviaGamesTable).set(updateField).where(eq(triviaGamesTable.id, gid));

    const done = newAnswers.length >= questionIds.length;
    res.json({ recorded: true, answeredCount: newAnswers.length, done });

    // Settle if applicable
    if (done) {
      // Refresh from DB
      const [updated] = await db.select().from(triviaGamesTable).where(eq(triviaGamesTable.id, gid)).limit(1);
      const p1Done = (updated.player1Answers as unknown[]).length >= questionIds.length;
      const p2Done = game.mode === "bot" || (updated.player2Answers as unknown[]).length >= questionIds.length;
      if (p1Done && p2Done) {
        void settleGame(gid).catch(() => {});
      }
    }
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/my-game
// ---------------------------------------------------------------------------
router.get("/trivia/my-game", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const games = await db.select().from(triviaGamesTable)
      .where(and(
        eq(triviaGamesTable.status, "active"),
        sql`(player1_id = ${req.userId} OR player2_id = ${req.userId})`,
      )).limit(1);
    if (games.length === 0) { res.json({ game: null }); return; }
    res.json({ game: games[0] });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/game/:id — full game result (after completed)
// ---------------------------------------------------------------------------
router.get("/trivia/game/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [game] = await db.select().from(triviaGamesTable)
      .where(eq(triviaGamesTable.id, gameId)).limit(1);
    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    if (game.player1Id !== req.userId && game.player2Id !== req.userId) {
      res.status(403).json({ error: "Not a participant" }); return;
    }

    const questionIds = game.questionIds as number[];
    const questions = await db.select().from(triviaQuestionsTable)
      .where(inArray(triviaQuestionsTable.id, questionIds));
    const ordered = questionIds.map(id => questions.find(q => q.id === id)!).filter(Boolean);

    // Compute payout for display
    const { feePct } = await getTriviaSettings();
    const pot = game.entryFee * 2;
    const fee = pot * feePct / 100;
    const winnings = pot - fee;
    const isWinner = game.winnerId === req.userId;
    const isTie = game.status === "completed" && game.winnerId === null;
    const refund = pot / 2 - fee / 2;
    const payout = isTie ? refund : (isWinner ? winnings : 0);
    const profit = isTie ? (refund - game.entryFee) : (isWinner ? winnings - game.entryFee : -game.entryFee);

    // Opponent username
    const opponentId = game.player1Id === req.userId ? game.player2Id : game.player1Id;
    let opponentUsername = "Bot";
    if (opponentId) {
      const [opp] = await db.select({ username: usersTable.username }).from(usersTable)
        .where(eq(usersTable.id, opponentId)).limit(1);
      opponentUsername = opp?.username ?? "Unknown";
    }

    res.json({
      ...game,
      questions: ordered.map(q => ({ ...q, options: q.options as string[] })),
      payout,
      profit,
      opponentUsername,
    });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/history
// ---------------------------------------------------------------------------
router.get("/trivia/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const games = await db.select().from(triviaGamesTable)
      .where(and(
        eq(triviaGamesTable.status, "completed"),
        sql`(player1_id = ${req.userId} OR player2_id = ${req.userId})`,
      ))
      .orderBy(desc(triviaGamesTable.endedAt))
      .limit(10);

    const { feePct } = await getTriviaSettings();
    const results = games.map(game => {
      const pot = game.entryFee * 2;
      const fee = pot * feePct / 100;
      const winnings = pot - fee;
      const isWinner = game.winnerId === req.userId;
      const isTie = game.winnerId === null;
      const refund = pot / 2 - fee / 2;
      const payout = isTie ? refund : (isWinner ? winnings : 0);
      const profit = isTie ? (refund - game.entryFee) : (isWinner ? winnings - game.entryFee : -game.entryFee);
      const myScore = game.player1Id === req.userId ? game.player1Score : game.player2Score;
      const oppScore = game.player1Id === req.userId ? game.player2Score : game.player1Score;
      return { ...game, payout, profit: parseFloat(profit.toFixed(2)), myScore, oppScore };
    });

    res.json(results);
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/challenges/:id — single challenge (for polling)
// ---------------------------------------------------------------------------
router.get("/trivia/challenges/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const challengeId = Number(req.params.id);
    if (Number.isNaN(challengeId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [challenge] = await db.select().from(triviaChallengesTable)
      .where(eq(triviaChallengesTable.id, challengeId)).limit(1);
    if (!challenge) { res.status(404).json({ error: "Challenge not found" }); return; }
    if (challenge.creatorId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }

    // Find linked game
    const [game] = await db.select({ id: triviaGamesTable.id })
      .from(triviaGamesTable)
      .where(eq(triviaGamesTable.challengeId, challengeId)).limit(1);

    res.json({ ...challenge, gameId: game?.id ?? null });
  } catch (err) { handleErr(err, res); }
});

// ---------------------------------------------------------------------------
// GET /api/trivia/events/:id — SSE for game completion
// ---------------------------------------------------------------------------
router.get("/trivia/events/:id", requireAuth, (req: Request, res: Response): void => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) { res.status(400).json({ error: "Invalid id" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const remove = addSseListener(gameId, data => {
    res.write(`data: ${data}\n\n`);
  });

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(keepAlive); remove(); });
});

export default router;
