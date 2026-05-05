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
// Crypto categories for the "Crypto" umbrella filter
// ---------------------------------------------------------------------------
const CRYPTO_CATEGORIES = new Set(["Bitcoin", "Ethereum", "DeFi", "Mining", "Altcoins", "Blockchain Basics", "NFTs", "Exchanges", "Crypto"]);

// Helper: pick random question IDs for a category (or all categories)
async function pickQuestionIds(category: string | undefined | null, count = 10): Promise<number[]> {
  let rows: { id: number }[];
  if (!category || category === "All") {
    rows = await db.select({ id: triviaQuestionsTable.id }).from(triviaQuestionsTable).where(eq(triviaQuestionsTable.isActive, true));
  } else if (category === "Crypto") {
    rows = await db.select({ id: triviaQuestionsTable.id }).from(triviaQuestionsTable)
      .where(and(eq(triviaQuestionsTable.isActive, true), sql`category = ANY(ARRAY['Bitcoin','Ethereum','DeFi','Mining','Altcoins','Blockchain Basics','NFTs','Exchanges'])`));
  } else {
    rows = await db.select({ id: triviaQuestionsTable.id }).from(triviaQuestionsTable)
      .where(and(eq(triviaQuestionsTable.isActive, true), eq(triviaQuestionsTable.category, category)));
  }
  if (rows.length < count) return [];
  return rows.sort(() => Math.random() - 0.5).slice(0, count).map(r => r.id);
}

// ---------------------------------------------------------------------------
// Seed trivia questions — category-aware (idempotent per category)
// ---------------------------------------------------------------------------
export async function seedTriviaQuestions(): Promise<void> {
  const count = await db.select({ n: sql<number>`count(*)` }).from(triviaQuestionsTable);
  const cryptoExists = Number(count[0].n) > 0;

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

  if (!cryptoExists) {
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

  // Seed new categories if not present
  type Q = { question: string; options: string[]; correctIndex: number; category: string; difficulty: string };

  const newCategorySeeds: { category: string; questions: Q[] }[] = [
    {
      category: "Agriculture",
      questions: [
        { question: "What is the process of growing crops without soil using nutrient solutions?", options: ["Hydroponics", "Aeroponics", "Aquaponics", "Permaculture"], correctIndex: 0, category: "Agriculture", difficulty: "medium" },
        { question: "Which gas do plants primarily use during photosynthesis?", options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], correctIndex: 2, category: "Agriculture", difficulty: "easy" },
        { question: "What is crop rotation?", options: ["Moving crops to another farm", "Planting different crops in sequence on the same land", "Rotating irrigation systems", "Turning soil before planting"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which nutrient is most important for leaf growth in plants?", options: ["Phosphorus", "Potassium", "Nitrogen", "Calcium"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is the pH range considered ideal for most crops?", options: ["4.0–5.0", "6.0–7.0", "8.0–9.0", "3.0–4.0"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What does NPK stand for in fertilizers?", options: ["Nitrogen, Phosphorus, Potassium", "Nickel, Palladium, Krypton", "Nitrate, Protein, Keratin", "Nitrogen, Potash, Kaolinite"], correctIndex: 0, category: "Agriculture", difficulty: "medium" },
        { question: "Which country is the world's largest producer of wheat?", options: ["USA", "India", "China", "Russia"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "What is a combine harvester used for?", options: ["Plowing fields", "Planting seeds", "Harvesting grain crops", "Spraying pesticides"], correctIndex: 2, category: "Agriculture", difficulty: "easy" },
        { question: "What is the term for land left unplanted for a season to recover nutrients?", options: ["Fallowing", "Composting", "Mulching", "Tilling"], correctIndex: 0, category: "Agriculture", difficulty: "medium" },
        { question: "Which type of farming uses no synthetic chemicals?", options: ["Conventional farming", "Organic farming", "Precision farming", "Intensive farming"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is the Green Revolution primarily associated with?", options: ["Environmental activism", "High-yield crop varieties and modern farming techniques", "Forest conservation", "Organic farming movement"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is drip irrigation?", options: ["Flooding fields with water", "Spraying water overhead", "Delivering water directly to roots in small amounts", "Using rainwater only"], correctIndex: 2, category: "Agriculture", difficulty: "easy" },
        { question: "Which crop is called the 'king of cereals'?", options: ["Wheat", "Rice", "Corn (Maize)", "Barley"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is slash-and-burn agriculture?", options: ["Burning diseased crops only", "Cutting and burning vegetation to clear land for farming", "Using flamethrowers to kill weeds", "Burning crop waste after harvest"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "Which animal is considered the most important livestock globally by number?", options: ["Cattle", "Pigs", "Sheep", "Chickens"], correctIndex: 3, category: "Agriculture", difficulty: "hard" },
        { question: "What does the term 'arable land' mean?", options: ["Land covered in trees", "Land suitable for plowing and growing crops", "Land used for livestock grazing", "Land near a water source"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which vitamin is synthesized by plants exposed to sunlight?", options: ["Vitamin A", "Vitamin C", "Vitamin D", "Vitamin K"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is aquaculture?", options: ["Growing crops underwater", "Farming of fish and aquatic organisms", "Water management for irrigation", "Testing water quality for crops"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is the primary purpose of pesticides in agriculture?", options: ["Promote plant growth", "Control pests and diseases", "Improve soil quality", "Increase water retention"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which crop is the world's largest source of vegetable oil?", options: ["Sunflower", "Palm", "Soybean", "Olive"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "What is composting?", options: ["Adding chemical fertilizers to soil", "Decomposing organic matter to create natural fertilizer", "Watering crops at night", "Mixing different soil types"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which country is the world's largest producer of rice?", options: ["India", "China", "Vietnam", "Thailand"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is terracing in farming?", options: ["Building greenhouse tiers", "Cutting steps into hillsides to create flat planting areas", "Rotating crops in rows", "Using raised garden beds"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is monoculture?", options: ["Growing many different crops together", "Cultivating a single crop over a large area", "Farming with only one tool", "Farming by a single person"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which plant is known for fixing nitrogen in the soil?", options: ["Corn", "Wheat", "Legumes (beans and peas)", "Sunflowers"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is integrated pest management (IPM)?", options: ["Using only chemical pesticides", "Combining biological, cultural, and chemical controls to manage pests", "Importing natural predators only", "Burning infested fields"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "Which country pioneered the concept of the agricultural cooperative?", options: ["USA", "Denmark", "Japan", "Australia"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is the purpose of a windbreak in farming?", options: ["To power wind turbines for irrigation", "Trees or shrubs planted to protect crops from wind erosion", "To create shade for livestock", "To mark field boundaries"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is precision agriculture?", options: ["Farming only small plots", "Using technology like GPS and sensors to optimize farm inputs", "Manually tending each plant", "Growing crops in precise geometric patterns"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What crop is Brazil the world's largest producer of?", options: ["Corn", "Wheat", "Coffee", "Sugarcane"], correctIndex: 3, category: "Agriculture", difficulty: "medium" },
        { question: "What is the function of stomata in leaves?", options: ["Absorbing sunlight", "Exchanging gases and regulating water loss", "Producing chlorophyll", "Storing nutrients"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the name for farming fish and plants together in a symbiotic environment?", options: ["Hydroponics", "Aquaponics", "Aeroponics", "Bioponics"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "Which crop is the primary source of corn starch?", options: ["Sweet corn", "Field corn (dent corn)", "Popcorn", "Baby corn"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is the Dust Bowl associated with?", options: ["Overuse of irrigation causing floods", "Severe wind erosion due to drought and poor farming practices in the 1930s USA", "Volcanic ash covering farmlands", "Severe hailstorms destroying crops"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What does GMO stand for in agriculture?", options: ["Genetically Modified Organism", "General Market Output", "Graded Mineral Ore", "Globally Managed Orchard"], correctIndex: 0, category: "Agriculture", difficulty: "easy" },
        { question: "What is the most widely grown grain crop globally?", options: ["Corn", "Wheat", "Rice", "Barley"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the term for growing plants on water with their roots submerged directly?", options: ["Aeroponics", "Deep water culture", "Fogponics", "Kratky method"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "Which continent produces the most cocoa?", options: ["South America", "Asia", "Africa", "North America"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What does soil erosion cause?", options: ["Increased soil fertility", "Loss of topsoil and reduced land productivity", "Greater water retention", "Better crop yields"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is a cash crop?", options: ["Crops grown for personal consumption", "Crops grown primarily for sale", "Crops that grow very fast", "Crops that require no water"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which vitamin is most abundant in carrots?", options: ["Vitamin B12", "Vitamin D", "Vitamin A (beta-carotene)", "Vitamin E"], correctIndex: 2, category: "Agriculture", difficulty: "easy" },
        { question: "What is a greenhouse used for?", options: ["Storing farm equipment", "Creating a controlled environment to grow plants year-round", "Housing livestock", "Processing harvested crops"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is the main function of phosphorus in plants?", options: ["Promotes leafy green growth", "Supports root development and energy transfer", "Helps in fruit pigmentation", "Regulates water uptake"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is salinization in agriculture?", options: ["Adding salt as fertilizer", "Accumulation of salt in soil, reducing fertility", "A method of preserving harvested crops", "Using saltwater for irrigation"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "Which crop is known as 'white gold' due to its economic importance?", options: ["Rice", "Sugar", "Cotton", "Rubber"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is the primary purpose of a grain elevator?", options: ["Transporting grain via conveyor belt", "Storing and handling large quantities of grain", "Processing grain into flour", "Drying wet grain in the field"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What percentage of Earth's freshwater use is attributed to agriculture?", options: ["40%", "55%", "70%", "85%"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "Which soil type is best for agriculture due to its nutrient richness?", options: ["Sandy soil", "Clay soil", "Loam soil", "Silt soil"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is vernalization in crop science?", options: ["Using chemicals to speed up growth", "Exposing seeds or plants to cold temperatures to trigger flowering", "Grafting plants together", "Harvesting crops in winter"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is subsistence farming?", options: ["Farming using government subsidies", "Growing only enough food to feed the farmer's family", "Large-scale commercial farming", "Farming on rented land"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which process converts atmospheric nitrogen into a plant-usable form?", options: ["Photosynthesis", "Nitrogen fixation", "Transpiration", "Osmosis"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the average time it takes to form one inch of natural topsoil?", options: ["10 years", "100 years", "500–1000 years", "50 years"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "Which pest is responsible for the Irish Potato Famine of the 1840s?", options: ["Locusts", "Aphids", "Potato blight fungus (Phytophthora infestans)", "Colorado potato beetle"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "What is the purpose of crop insurance?", options: ["Protecting livestock from disease", "Compensating farmers for crop losses due to weather or pests", "Covering equipment breakdown costs", "Insuring farm property against theft"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which farming practice involves growing trees alongside crops?", options: ["Silviculture", "Agroforestry", "Floriculture", "Horticulture"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the most cultivated fruit in the world?", options: ["Banana", "Apple", "Tomato", "Grape"], correctIndex: 3, category: "Agriculture", difficulty: "hard" },
        { question: "What is a root vegetable?", options: ["A vegetable that grows above ground", "A vegetable whose edible part grows underground", "A vegetable with visible roots above soil", "Any leafy vegetable"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What are cover crops used for?", options: ["Providing shade for other crops", "Protecting and improving soil between main crop seasons", "Covering crop yields from weather damage", "Providing animal feed only"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "Which insect is called the 'destroyer of agriculture' due to its swarms?", options: ["Aphid", "Locust", "Boll weevil", "Whitefly"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What does overgrazing cause?", options: ["Increased soil fertility", "Soil compaction and erosion", "Better grass regeneration", "Improved water retention"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What crop is tequila made from?", options: ["Sugarcane", "Agave plant", "Corn", "Cactus fruit"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which agricultural tool is used to break and loosen soil before planting?", options: ["Harvester", "Plow", "Seeder", "Sprayer"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is the purpose of mulching?", options: ["Adding nutrients to deep subsoil", "Conserving soil moisture and suppressing weeds", "Killing soil bacteria", "Aerating dense clay soils"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which country has the largest agricultural land area?", options: ["Brazil", "USA", "Russia", "China"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "What are pollinators and why are they important in agriculture?", options: ["Machines that spread pollen commercially", "Animals/insects that transfer pollen, essential for fruit and seed production", "Chemicals that fertilize crops", "Wind systems that spread seeds"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which crop is known as the 'golden grain' of the Andes?", options: ["Potato", "Quinoa", "Amaranth", "Maize"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the main cause of deforestation globally?", options: ["Urbanization", "Agricultural expansion", "Mining activities", "Wildfire"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is biofortification?", options: ["Adding artificial vitamins to crops after harvest", "Breeding crops to have higher nutritional content", "Fortifying soil with microorganisms", "Adding probiotics to animal feed"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What was Norman Borlaug famous for in agriculture?", options: ["Inventing the tractor", "Developing high-yield wheat varieties that led to the Green Revolution", "Discovering crop rotation", "Creating the first GMO plant"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "Which hormone causes fruit ripening?", options: ["Auxin", "Cytokinin", "Ethylene", "Gibberellin"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
        { question: "What is seed dormancy?", options: ["Seeds that never germinate", "A state where seeds delay germination until conditions are right", "Seeds destroyed by freezing", "Over-watered seeds that rot"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "Which country produces the most coffee in the world?", options: ["Colombia", "Ethiopia", "Brazil", "Vietnam"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "What is the Haber-Bosch process?", options: ["A method for purifying drinking water", "A process to synthesize ammonia from nitrogen and hydrogen for fertilizers", "A technique for preserving grain", "A method to test soil pH"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What does it mean for a crop to be 'drought-resistant'?", options: ["It grows better with more water", "It can survive and produce with minimal water", "It requires draining excess water", "It is immune to flood damage"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which farming method uses fish waste to fertilize plants?", options: ["Hydroponics", "Aquaponics", "Permaculture", "Aeroponics"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the most common use of soybeans worldwide?", options: ["Human food consumption", "Animal feed", "Biodiesel production", "Pharmaceutical use"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "Which region is known as the 'breadbasket' of the world?", options: ["The Amazon Basin", "The Great Plains of North America", "The Sahara region", "The Australian Outback"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is a GMO crop resistant to?", options: ["Always resists only insects", "Depends on modification — pests, herbicides, disease, or drought", "Only resistant to drought", "Only resistant to herbicides"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the term for cultivating plants on hillside steps?", options: ["Terrace farming", "Strip farming", "Contour farming", "Ridge farming"], correctIndex: 0, category: "Agriculture", difficulty: "easy" },
        { question: "Which major world crop is primarily grown submerged in water?", options: ["Wheat", "Rice", "Barley", "Oats"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What does a soil pH below 7 indicate?", options: ["Alkaline soil", "Neutral soil", "Acidic soil", "Saline soil"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "Which part of the plant anchors it to the soil and absorbs water?", options: ["Stem", "Roots", "Leaves", "Flowers"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is a cash crop primarily grown in tropical regions?", options: ["Wheat", "Barley", "Sugar cane", "Oats"], correctIndex: 2, category: "Agriculture", difficulty: "easy" },
        { question: "What is biofuel in the context of agriculture?", options: ["Fuel made from fossil fuels in farms", "Fuel derived from biological materials like crops and animal waste", "Solar energy used in farming", "Energy from crop irrigation systems"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which vitamin deficiency does rice fortification primarily address in Asia?", options: ["Vitamin C", "Vitamin A", "Vitamin B12", "Vitamin D"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is the primary factor driving food insecurity globally?", options: ["Lack of agricultural land", "Unequal food distribution and poverty", "Too few crop varieties", "Climate being too hot globally"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the term for the study of soils?", options: ["Geology", "Pedology", "Agronomy", "Botany"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is the most important greenhouse gas produced by agriculture?", options: ["Carbon dioxide", "Methane", "Nitrous oxide", "Water vapor"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What is crop yield?", options: ["The total area farmed", "The amount of agricultural produce harvested per unit area", "The quality grade of a crop", "The number of crop varieties grown"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "Which African country is known as the 'Coffee Kingdom'?", options: ["Kenya", "Ethiopia", "Uganda", "Tanzania"], correctIndex: 1, category: "Agriculture", difficulty: "medium" },
        { question: "What does 'free-range' mean on a food label?", options: ["The animals have some access to the outdoors", "The product costs nothing", "No chemicals were used in production", "Animals were fed only grass"], correctIndex: 0, category: "Agriculture", difficulty: "easy" },
        { question: "What is the role of mycorrhizal fungi in agriculture?", options: ["They harm plant roots", "They help plants absorb water and nutrients from soil", "They decompose crop waste", "They fix nitrogen in the atmosphere"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is the difference between annuals and perennials?", options: ["Annuals are larger", "Annuals complete their life cycle in one year; perennials live multiple years", "Perennials are more nutritious", "Annuals grow in tropical regions only"], correctIndex: 1, category: "Agriculture", difficulty: "easy" },
        { question: "What is the most efficient method of water application in modern farming?", options: ["Flood irrigation", "Sprinkler irrigation", "Drip (trickle) irrigation", "Furrow irrigation"], correctIndex: 2, category: "Agriculture", difficulty: "medium" },
        { question: "Which organization sets global food safety standards?", options: ["FAO", "Codex Alimentarius Commission", "WHO", "World Bank"], correctIndex: 1, category: "Agriculture", difficulty: "hard" },
        { question: "What is the largest agricultural export of the USA?", options: ["Corn", "Wheat", "Soybeans", "Cotton"], correctIndex: 2, category: "Agriculture", difficulty: "hard" },
      ],
    },
    {
      category: "Movies",
      questions: [
        { question: "Which movie won the first Academy Award for Best Picture?", options: ["Wings", "All Quiet on the Western Front", "Cimarron", "Grand Hotel"], correctIndex: 0, category: "Movies", difficulty: "hard" },
        { question: "Who directed the 1975 thriller 'Jaws'?", options: ["George Lucas", "Francis Ford Coppola", "Steven Spielberg", "Brian De Palma"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Which film holds the record for the most Academy Awards won (11 Oscars)?", options: ["Titanic", "Ben-Hur", "The Lord of the Rings: The Return of the King", "All three (tied)"], correctIndex: 3, category: "Movies", difficulty: "hard" },
        { question: "Who played Iron Man in the Marvel Cinematic Universe?", options: ["Chris Evans", "Chris Hemsworth", "Robert Downey Jr.", "Mark Ruffalo"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What is the highest-grossing film of all time (adjusted for inflation)?", options: ["Avatar", "Avengers: Endgame", "Gone with the Wind", "Titanic"], correctIndex: 2, category: "Movies", difficulty: "hard" },
        { question: "Which actor has won the most Academy Awards for Best Actor?", options: ["Jack Nicholson", "Marlon Brando", "Daniel Day-Lewis", "Spencer Tracy"], correctIndex: 2, category: "Movies", difficulty: "hard" },
        { question: "What year was the first Star Wars film released?", options: ["1975", "1977", "1979", "1982"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Who played Jack Dawson in the 1997 film 'Titanic'?", options: ["Brad Pitt", "Tom Cruise", "Leonardo DiCaprio", "Matt Damon"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "In 'The Silence of the Lambs', what was Hannibal Lecter's occupation?", options: ["Judge", "Surgeon", "Psychiatrist", "Professor"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Which studio produced the original animated film 'The Lion King' (1994)?", options: ["Pixar", "DreamWorks", "Walt Disney Animation Studios", "Warner Bros."], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the fictional African nation in 'Black Panther'?", options: ["Narnia", "Wakanda", "Zamunda", "Sokovia"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Who directed 'Schindler's List' (1993)?", options: ["Martin Scorsese", "Steven Spielberg", "Stanley Kubrick", "Oliver Stone"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Which film features the line 'You can't handle the truth!'?", options: ["A Few Good Men", "Crimson Tide", "Top Gun", "The Firm"], correctIndex: 0, category: "Movies", difficulty: "medium" },
        { question: "Who directed the 'Dark Knight' trilogy?", options: ["Tim Burton", "Joel Schumacher", "Christopher Nolan", "Zack Snyder"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What 2003 film won the Best Animated Feature Oscar for the first time a Pixar film won that award (after it was established)?", options: ["Monsters, Inc.", "Finding Nemo", "The Incredibles", "Ratatouille"], correctIndex: 1, category: "Movies", difficulty: "hard" },
        { question: "Which actress played Katniss Everdeen in 'The Hunger Games'?", options: ["Emma Watson", "Jennifer Lawrence", "Shailene Woodley", "Hailee Steinfeld"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What country produced the film 'Parasite' (2019 Best Picture winner)?", options: ["Japan", "China", "South Korea", "Taiwan"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Which actor played Forrest Gump in the 1994 film?", options: ["Tom Cruise", "Tom Hanks", "Kevin Costner", "Brad Pitt"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the toy cowboy in 'Toy Story'?", options: ["Buzz", "Rex", "Woody", "Bo"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who played the Joker in 'The Dark Knight' (2008)?", options: ["Jared Leto", "Jack Nicholson", "Heath Ledger", "Joaquin Phoenix"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Which film features the character Darth Vader?", options: ["Star Trek", "Star Wars", "Blade Runner", "The Matrix"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What is the highest-grossing animated film of all time?", options: ["Frozen", "The Lion King (2019)", "The Incredibles", "Minions"], correctIndex: 1, category: "Movies", difficulty: "hard" },
        { question: "Who starred as John Wick in the action film series?", options: ["Liam Neeson", "Jason Statham", "Keanu Reeves", "Denzel Washington"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What film is famous for the shower scene featuring Janet Leigh?", options: ["Rear Window", "Vertigo", "Psycho", "The Birds"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Which 1939 movie features 'Somewhere Over the Rainbow'?", options: ["Snow White", "Cinderella", "The Wizard of Oz", "Fantasia"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "In 'Avengers: Infinity War', how many Infinity Stones are there?", options: ["4", "5", "6", "7"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who directed 'Pulp Fiction' (1994)?", options: ["Martin Scorsese", "Quentin Tarantino", "Robert Rodriguez", "Joel Coen"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What film features the quote 'Here's looking at you, kid'?", options: ["Gone with the Wind", "Casablanca", "Citizen Kane", "It's a Wonderful Life"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Who played Neo in 'The Matrix' (1999)?", options: ["Will Smith", "Tom Hanks", "Keanu Reeves", "Nicolas Cage"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What year was 'Avengers: Endgame' released?", options: ["2017", "2018", "2019", "2020"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Which director is known for films like '2001: A Space Odyssey' and 'The Shining'?", options: ["Alfred Hitchcock", "Stanley Kubrick", "Ridley Scott", "David Lynch"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What is the name of the shark in 'Finding Nemo'?", options: ["Gill", "Bruce", "Crush", "Anchor"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which actress played Clarice Starling in 'The Silence of the Lambs'?", options: ["Meryl Streep", "Jodie Foster", "Sigourney Weaver", "Glenn Close"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What does CGI stand for in filmmaking?", options: ["Camera Generated Images", "Computer Generated Imagery", "Cinematic Graphic Interface", "Color Grading Index"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Which film is based on a Stephen King novel about a haunted hotel?", options: ["Carrie", "It", "The Shining", "Misery"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who composed the iconic 'Star Wars' theme?", options: ["Hans Zimmer", "John Williams", "Ennio Morricone", "Howard Shore"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What is the name of the fictional kingdom in 'Frozen'?", options: ["Arendelle", "Stormhold", "Duloc", "Agrabah"], correctIndex: 0, category: "Movies", difficulty: "easy" },
        { question: "Which actress has won the most Academy Awards for Best Actress?", options: ["Meryl Streep", "Katharine Hepburn", "Bette Davis", "Cate Blanchett"], correctIndex: 1, category: "Movies", difficulty: "hard" },
        { question: "What is the name of the spaceship in 'Alien' (1979)?", options: ["Discovery", "Sulaco", "Nostromo", "Prometheus"], correctIndex: 2, category: "Movies", difficulty: "hard" },
        { question: "In 'The Godfather', who makes 'an offer he can't refuse'?", options: ["Vito Corleone", "Michael Corleone", "Tom Hagen", "Sonny Corleone"], correctIndex: 0, category: "Movies", difficulty: "medium" },
        { question: "Which 2010 film directed by Christopher Nolan deals with entering dreams?", options: ["Interstellar", "The Prestige", "Inception", "Memento"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who played James Bond in the most films?", options: ["Sean Connery", "Roger Moore", "Daniel Craig", "Pierce Brosnan"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which movie features the song 'My Heart Will Go On'?", options: ["Ghost", "The Bodyguard", "Dirty Dancing", "Titanic"], correctIndex: 3, category: "Movies", difficulty: "easy" },
        { question: "What Oscar category did 'Get Out' (2017) win?", options: ["Best Picture", "Best Director", "Best Original Screenplay", "Best Film Editing"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Who directed 'Jurassic Park' (1993)?", options: ["James Cameron", "Steven Spielberg", "George Lucas", "Robert Zemeckis"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What is the real name of Batman in the films?", options: ["Clark Kent", "Bruce Banner", "Bruce Wayne", "Peter Parker"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What film features the line 'I'll be back'?", options: ["Rambo", "The Terminator", "Die Hard", "Predator"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What country makes the most films per year?", options: ["USA", "China", "India (Bollywood/regional)", "Nigeria"], correctIndex: 2, category: "Movies", difficulty: "hard" },
        { question: "Who directed 'Avatar' (2009)?", options: ["Peter Jackson", "Ridley Scott", "James Cameron", "J.J. Abrams"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Which animated film was the first to be nominated for Best Picture at the Oscars?", options: ["The Lion King", "Beauty and the Beast", "Aladdin", "Toy Story"], correctIndex: 1, category: "Movies", difficulty: "hard" },
        { question: "Which film franchise features the character 'Ethan Hunt'?", options: ["James Bond", "Mission: Impossible", "Bourne", "Fast & Furious"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What 1993 Spielberg film dramatized the Holocaust?", options: ["Munich", "Saving Private Ryan", "Empire of the Sun", "Schindler's List"], correctIndex: 3, category: "Movies", difficulty: "easy" },
        { question: "Which actor played Wolverine in the X-Men films?", options: ["Hugh Jackman", "Liam Neeson", "Christian Bale", "Russell Crowe"], correctIndex: 0, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the fictional city where Batman lives?", options: ["Metropolis", "Star City", "Gotham City", "Central City"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What award is given for the best film at the Cannes Film Festival?", options: ["Golden Bear", "Palme d'Or", "Golden Lion", "Grand Jury Prize"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which film has the famous chest-burster alien scene?", options: ["The Thing", "Predator", "Alien", "Species"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "What 1977 film features Han Solo, Luke Skywalker, and Princess Leia?", options: ["Star Trek", "The Last Starfighter", "Star Wars: A New Hope", "Battlestar Galactica"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who starred as Tony Montana in 'Scarface' (1983)?", options: ["Robert De Niro", "Al Pacino", "Joe Pesci", "James Caan"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What year was the Pixar film 'Up' released?", options: ["2007", "2008", "2009", "2010"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Which superhero film was the first to gross over $1 billion worldwide?", options: ["Iron Man", "The Avengers", "The Dark Knight", "Spider-Man"], correctIndex: 2, category: "Movies", difficulty: "hard" },
        { question: "Who wrote and directed 'Get Out' (2017)?", options: ["Spike Lee", "Ryan Coogler", "Jordan Peele", "Ava DuVernay"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "What film features 'The Dude' as its main character?", options: ["Fargo", "The Big Lebowski", "No Country for Old Men", "Raising Arizona"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which film director is known as the 'Master of Suspense'?", options: ["Stanley Kubrick", "Alfred Hitchcock", "Brian De Palma", "Dario Argento"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What movie features a computer named HAL 9000?", options: ["The Terminator", "Ex Machina", "2001: A Space Odyssey", "Colossus: The Forbin Project"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "Who wrote the novel 'Jurassic Park' that the film is based on?", options: ["Stephen King", "John Grisham", "Michael Crichton", "Tom Clancy"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "What was the first feature-length animated Disney film?", options: ["Pinocchio", "Bambi", "Dumbo", "Snow White and the Seven Dwarfs"], correctIndex: 3, category: "Movies", difficulty: "medium" },
        { question: "Which film won Best Picture at the 2020 Academy Awards?", options: ["1917", "Joker", "Once Upon a Time in Hollywood", "Parasite"], correctIndex: 3, category: "Movies", difficulty: "medium" },
        { question: "Who directed the original 'Batman' (1989) starring Michael Keaton?", options: ["Joel Schumacher", "Tim Burton", "Richard Donner", "Bryan Singer"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What is the subtitle of the second film in 'The Godfather' series?", options: ["The Return", "Part II", "The Legacy", "Corleone"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What nationality is the director Akira Kurosawa?", options: ["Chinese", "Korean", "Japanese", "Thai"], correctIndex: 2, category: "Movies", difficulty: "medium" },
        { question: "In 'E.T. the Extra-Terrestrial', what does ET want to do?", options: ["Conquer Earth", "Find food", "Phone home", "Befriend the US government"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Which Marvel character is known as 'the Sorcerer Supreme'?", options: ["Thor", "Doctor Strange", "Vision", "Black Panther"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What is the first rule of Fight Club?", options: ["Always win", "Never talk about Fight Club", "Fight fairly", "Only fists allowed"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What iconic line does Buzz Lightyear say in 'Toy Story'?", options: ["To the stars and beyond!", "Infinity is just the beginning!", "To infinity and beyond!", "The sky is never the limit!"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "Who played 'The Truman Show' main character Truman Burbank?", options: ["Will Smith", "Jim Carrey", "Robin Williams", "Tom Hanks"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What does IMAX stand for?", options: ["International Maximum", "Image Maximum", "Intense Maximum Experience", "Interactive Maximum"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which 2014 film starred Matthew McConaughey as an astronaut traveling through a wormhole?", options: ["Gravity", "The Martian", "Interstellar", "Ad Astra"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the villain in 'The Lion King'?", options: ["Nala", "Mufasa", "Scar", "Zazu"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "In 'Forrest Gump', what famous quote does Forrest say about life?", options: ["Life is like a book with many chapters", "Life is like a box of chocolates, you never know what you're gonna get", "Life is short, so live it fully", "Life moves pretty fast"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Which director made 'Apocalypse Now' (1979)?", options: ["Oliver Stone", "Francis Ford Coppola", "Martin Scorsese", "Michael Cimino"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "In 'Home Alone', where are Kevin's parents traveling to when they leave him?", options: ["London", "Paris", "Rome", "New York"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "Which film features a character who ages backwards?", options: ["The Curious Case of Benjamin Button", "Big Fish", "Cloud Atlas", "The Time Traveler's Wife"], correctIndex: 0, category: "Movies", difficulty: "easy" },
        { question: "What instrument does Jack Black's character teach in 'School of Rock'?", options: ["Guitar", "Drums", "Bass guitar", "Keyboard"], correctIndex: 0, category: "Movies", difficulty: "medium" },
        { question: "What is the name of the robot in 'WALL-E'?", options: ["R2-D2", "EVE and WALL-E", "HAL 9000", "Optimus"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Which film features Tom Hanks as a man stranded on a desert island?", options: ["Philadelphia", "Cast Away", "The Terminal", "Big"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "In which film does Russell Crowe play a gladiator named Maximus?", options: ["Ben-Hur", "Troy", "Gladiator", "Spartacus"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What song plays over the opening credits of 'Guardians of the Galaxy'?", options: ["Don't Stop Me Now", "Come and Get Your Love", "Born to Run", "We Are the Champions"], correctIndex: 1, category: "Movies", difficulty: "medium" },
        { question: "What is the final word spoken in 'Citizen Kane'?", options: ["Rosebud", "Kane", "Empire", "Remember"], correctIndex: 0, category: "Movies", difficulty: "medium" },
        { question: "Which famous director appears in cameos in his own movies?", options: ["James Cameron", "Steven Spielberg", "Alfred Hitchcock", "George Lucas"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "In 'The Matrix', which pill does Neo take?", options: ["Blue pill", "Red pill", "Green pill", "White pill"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the cursed ring in 'The Lord of the Rings'?", options: ["The Ring of Power", "The One Ring", "The Dark Ring", "Sauron's Band"], correctIndex: 1, category: "Movies", difficulty: "easy" },
        { question: "Who played Captain Jack Sparrow in 'Pirates of the Caribbean'?", options: ["Orlando Bloom", "Geoffrey Rush", "Johnny Depp", "Javier Bardem"], correctIndex: 2, category: "Movies", difficulty: "easy" },
        { question: "What is the name of the ship in 'Titanic' (1997) that sinks?", options: ["Olympic", "Britannic", "Lusitania", "Titanic"], correctIndex: 3, category: "Movies", difficulty: "easy" },
        { question: "What film features the song 'Let It Go'?", options: ["Tangled", "Moana", "Brave", "Frozen"], correctIndex: 3, category: "Movies", difficulty: "easy" },
        { question: "Which actor played Thanos in Avengers: Infinity War?", options: ["Vin Diesel", "Josh Brolin", "Dave Bautista", "Bradley Cooper"], correctIndex: 1, category: "Movies", difficulty: "medium" },
      ],
    },
    {
      category: "Business",
      questions: [
        { question: "What does CEO stand for?", options: ["Chief Executive Officer", "Corporate Executive Organizer", "Central Executive Official", "Company Executive Officer"], correctIndex: 0, category: "Business", difficulty: "easy" },
        { question: "What is the stock market?", options: ["A supermarket for wholesale goods", "A marketplace where shares of companies are bought and sold", "A government bond exchange", "A commodity trading floor"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does IPO stand for?", options: ["Initial Public Offering", "International Purchase Order", "Investment Portfolio Option", "Internal Payment Obligation"], correctIndex: 0, category: "Business", difficulty: "medium" },
        { question: "Which company was the first to reach a $1 trillion market capitalization?", options: ["Microsoft", "Amazon", "Apple", "Google"], correctIndex: 2, category: "Business", difficulty: "medium" },
        { question: "What is GDP?", options: ["Government Debt Projection", "Gross Domestic Product", "Global Development Plan", "General Distribution of Profits"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "Who is the founder of Tesla and SpaceX?", options: ["Jeff Bezos", "Bill Gates", "Elon Musk", "Larry Page"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What is inflation?", options: ["Decrease in prices", "Increase in the general price level of goods and services over time", "Rising unemployment", "Increase in government spending"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does ROI stand for?", options: ["Return on Investment", "Rate of Inflation", "Ratio of Income", "Revenue Over Input"], correctIndex: 0, category: "Business", difficulty: "easy" },
        { question: "Which is the world's largest stock exchange by market capitalization?", options: ["Tokyo Stock Exchange", "Shanghai Stock Exchange", "New York Stock Exchange (NYSE)", "London Stock Exchange"], correctIndex: 2, category: "Business", difficulty: "medium" },
        { question: "What is a balance sheet?", options: ["A report on employee performance", "A financial statement showing assets, liabilities, and equity at a point in time", "A summary of monthly cash flows", "A profit and loss statement"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Who founded Amazon?", options: ["Larry Ellison", "Jeff Bezos", "Steve Jobs", "Jack Ma"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is a monopoly in business?", options: ["Having two major competitors", "A market with a single dominant seller", "A government-run company", "A cooperative business structure"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does B2B mean in business?", options: ["Business to Buyer", "Business to Business", "Bank to Bank", "Borrower to Bank"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is venture capital?", options: ["Loans from commercial banks", "Funding provided to startups in exchange for equity", "Money invested in government bonds", "Personal savings used to start a business"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a startup?", options: ["A large established corporation", "A newly founded business with high growth potential", "A franchised store branch", "A government-funded research project"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is the concept of 'supply and demand'?", options: ["Government control of prices", "The relationship between product availability and consumer desire", "The process of manufacturing goods", "A banking regulation framework"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "Which company is known for the iPhone?", options: ["Samsung", "Google", "Apple", "Microsoft"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What does CFO stand for?", options: ["Chief Financial Officer", "Corporate Finance Organizer", "Central Funding Official", "Chief Forecasting Officer"], correctIndex: 0, category: "Business", difficulty: "easy" },
        { question: "What is market share?", options: ["A company's percentage of total sales in an industry", "The number of employees in a company", "The amount of shares sold in an IPO", "The total revenue of a company"], correctIndex: 0, category: "Business", difficulty: "medium" },
        { question: "Who founded Microsoft?", options: ["Steve Jobs", "Bill Gates", "Larry Page", "Mark Zuckerberg"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is a business model?", options: ["A physical prototype of a product", "A plan for how a company creates, delivers, and captures value", "An organizational chart", "A government license to operate"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does ETF stand for in investing?", options: ["Exchange Traded Fund", "Equity Transfer Form", "External Treasury Fund", "Estimated Tax Filing"], correctIndex: 0, category: "Business", difficulty: "medium" },
        { question: "What is compound interest?", options: ["Interest earned only on principal", "Interest earned on both the principal and accumulated interest", "A fixed interest rate for loans", "A government subsidy program"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Who is considered the father of modern capitalism?", options: ["Karl Marx", "John Maynard Keynes", "Adam Smith", "Milton Friedman"], correctIndex: 2, category: "Business", difficulty: "medium" },
        { question: "What is a dividend in stocks?", options: ["The price paid when buying a stock", "A portion of company profits paid to shareholders", "A type of government bond", "Annual tax on stock holdings"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the Forbes 500 list?", options: ["500 most innovative companies worldwide", "500 wealthiest individuals globally", "500 largest companies by revenue in the US", "500 fastest-growing startups globally"], correctIndex: 2, category: "Business", difficulty: "medium" },
        { question: "What is SWOT analysis?", options: ["Software Work Output Tracker", "Strengths, Weaknesses, Opportunities, Threats analysis", "Sales, Wages, Operations, Tax framework", "Strategic Work and Output Template"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Which company's logo is a bitten apple?", options: ["Google", "Amazon", "Apple", "Microsoft"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What is a hedge fund?", options: ["A fund investing only in agricultural commodities", "An actively managed investment fund using various strategies to earn returns", "A government safety net for failing banks", "A type of mutual fund"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What does KPI stand for?", options: ["Key Performance Indicator", "Knowledge and Process Index", "Key Profit Impact", "Core Performance Item"], correctIndex: 0, category: "Business", difficulty: "easy" },
        { question: "What is the gig economy?", options: ["A music industry business model", "An economy based on temporary, freelance, and independent contractor work", "A government job creation program", "An economy driven by technology startups"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does P&L stand for in business?", options: ["Price & Labor", "Profit & Loss", "Products & Logistics", "Payment & Liability"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "Who founded Facebook (now Meta)?", options: ["Jack Dorsey", "Elon Musk", "Mark Zuckerberg", "Larry Page"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What is market capitalization?", options: ["The total number of company employees", "Total value of a company's outstanding shares", "Annual revenue of a company", "Total company assets"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a bear market?", options: ["A market dominated by female investors", "A financial market experiencing declining prices over time", "A market for livestock", "A commodity exchange for animal products"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does 'revenue' mean?", options: ["Net profit after expenses", "Total income generated from sales before expenses", "Total assets of a company", "Dividends paid to shareholders"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "Which country has the world's largest economy by GDP?", options: ["China", "European Union", "USA", "Japan"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What is a franchise business model?", options: ["A model where the government funds businesses", "A model where a business licenses its brand and operations to others", "A cooperative where employees own the company", "A non-profit business structure"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the difference between assets and liabilities?", options: ["Assets are owned resources; liabilities are what you owe", "Assets are costs; liabilities are income", "Assets are people; liabilities are equipment", "Assets are short-term; liabilities are long-term"], correctIndex: 0, category: "Business", difficulty: "easy" },
        { question: "What is a Bull market?", options: ["A market with rising animal prices", "A market characterized by rising prices and investor optimism", "A market for agricultural products", "A government stimulus-driven market"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is brand equity?", options: ["The physical value of a company's logo", "The commercial value derived from consumer perception of the brand", "The cost to register a trademark", "The market value of advertising spend"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is e-commerce?", options: ["Electronic communication between companies", "Buying and selling of goods over the internet", "Electronic accounting system", "Email-based customer service"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is the purpose of a business plan?", options: ["A legal document required for all businesses", "A roadmap outlining goals, strategies, and financial projections", "A government contract", "A list of employee responsibilities"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is depreciation in accounting?", options: ["Increase in asset value over time", "Gradual decrease in asset value due to wear and aging", "Currency devaluation", "Decrease in profits"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Which company pioneered the modern assembly line?", options: ["General Motors", "Ford Motor Company", "Chrysler", "Boeing"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a non-disclosure agreement (NDA)?", options: ["A performance review contract", "A contract requiring parties to keep shared information confidential", "A partnership agreement", "An employment contract"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does 'cash flow' measure?", options: ["The total profits of a company", "The movement of money in and out of a business", "The total value of company assets", "The credit available to a business"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Who is known as the 'Oracle of Omaha'?", options: ["Jeff Bezos", "Charlie Munger", "Warren Buffett", "George Soros"], correctIndex: 2, category: "Business", difficulty: "medium" },
        { question: "What is outsourcing?", options: ["Moving a company's headquarters abroad", "Hiring external parties to perform tasks or services", "Selling shares to foreign investors", "Exporting products to other countries"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is a blue-chip stock?", options: ["A newly listed penny stock", "Shares in a large, well-established financially stable company", "A government bond", "A technology startup share"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does 'economies of scale' mean?", options: ["A country's total economic output", "Cost advantages gained by increasing production volume", "The balance between import and export", "Tax incentives for large businesses"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Which business concept involves selling products below cost to drive competitors out?", options: ["Value-based pricing", "Price skimming", "Predatory pricing", "Bundle pricing"], correctIndex: 2, category: "Business", difficulty: "hard" },
        { question: "What is a mutual fund?", options: ["A company credit line", "A pooled investment vehicle managed by professionals", "A government savings account", "A fixed-rate corporate bond"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does CRM stand for in business?", options: ["Customer Revenue Management", "Customer Relationship Management", "Corporate Revenue Module", "Central Retail Management"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is the purpose of marketing?", options: ["Managing company finances", "Communicating value to attract and retain customers", "Overseeing production processes", "Hiring qualified employees"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is a patent?", options: ["A type of business license", "Exclusive rights granted to an inventor for a limited time", "A government business grant", "A trademark registration"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is the purpose of a Board of Directors?", options: ["To manage daily operations", "To oversee management and protect shareholder interests", "To hire all company employees", "To handle customer complaints"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a recession?", options: ["A period of rapid economic growth", "Two consecutive quarters of negative GDP growth", "Rising unemployment without GDP decline", "Hyperinflation period"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Which country is home to the BRICS nations' New Development Bank?", options: ["Brazil", "Russia", "China", "South Africa"], correctIndex: 2, category: "Business", difficulty: "hard" },
        { question: "What is the primary function of a central bank?", options: ["Provide loans to individuals", "Manage a country's money supply and monetary policy", "Collect taxes for government", "Regulate the stock market"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What does the term 'liquid assets' mean?", options: ["Physical commodities like oil and water", "Assets easily converted to cash without significant loss", "Stocks held in retirement accounts", "Long-term real estate investments"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Who is the founder of Virgin Group?", options: ["Philip Green", "Alan Sugar", "Richard Branson", "James Dyson"], correctIndex: 2, category: "Business", difficulty: "easy" },
        { question: "What is price elasticity of demand?", options: ["The relationship between a product's price and its quality", "How sensitive consumer demand is to price changes", "Government regulation of prices", "The effect of inflation on product prices"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is the purpose of an audit?", options: ["To develop marketing strategy", "To independently examine and verify financial statements", "To hire new employees", "To create a new product line"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a startup's 'runway'?", options: ["Its physical office space", "How long it can operate before running out of funding", "Its growth rate", "Its market share trajectory"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the difference between gross and net profit?", options: ["They are the same thing", "Gross profit is revenue minus cost of goods sold; net profit deducts all expenses", "Net profit is before taxes; gross is after", "Gross profit includes investments; net does not"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a joint venture?", options: ["When a company goes public", "A business arrangement where two parties cooperate on a specific project", "A merger of two companies", "A government-private sector partnership"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the role of Human Resources (HR)?", options: ["Managing customer accounts", "Managing employee-related functions like hiring, training, and benefits", "Overseeing financial reporting", "Marketing and advertising"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does 'bootstrapping' mean for startups?", options: ["Getting maximum government funding", "Building a company using personal savings and reinvested revenue", "Hiring contractors from global markets", "Rapidly expanding to multiple markets"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is a bond in investing?", options: ["A company ownership stake", "A debt instrument where an investor loans money to an entity", "A physical gold certificate", "A high-risk stock option"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What famous principle states that 80% of results come from 20% of causes?", options: ["The SWOT Principle", "The Pareto Principle", "The Maslow Hierarchy", "The Porter Principle"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the World Trade Organization (WTO) responsible for?", options: ["Regulating global banking", "Overseeing rules of international trade between countries", "Managing global climate policy", "Providing development loans to poor nations"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What was the first publicly traded company in history?", options: ["East India Company", "Dutch East India Company", "South Sea Company", "Bank of England"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is a tender offer in business?", options: ["A friendly business greeting", "An offer to buy shares directly from shareholders at a premium", "A contract offer to suppliers", "A government contract bid"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is the minimum wage?", options: ["The salary of a CEO", "The lowest legal hourly rate employers can pay workers", "The average national wage", "The wage for government employees"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does 'B2C' mean in business?", options: ["Business to Country", "Business to Consumer", "Brand to Client", "Base to Consumer"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is the difference between a merger and an acquisition?", options: ["They are the same", "A merger combines two equal companies; an acquisition is one company buying another", "Mergers are hostile; acquisitions are friendly", "Only public companies can merge"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is quantitative easing?", options: ["Tightening money supply to fight inflation", "Central bank buying assets to inject money into the economy", "Raising interest rates", "Reducing government spending"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is a fiduciary duty?", options: ["A legal obligation to act in someone else's best interest", "A government tax on investment returns", "A mandatory audit requirement", "An obligation to share financial records publicly"], correctIndex: 0, category: "Business", difficulty: "hard" },
        { question: "What does 'overhead costs' refer to?", options: ["Cost of raw materials", "Ongoing business expenses not directly tied to production (rent, utilities, admin)", "Marketing expenses only", "Employee salaries"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What are equity shares?", options: ["Debt instruments issued by companies", "Ownership stakes in a company that entitle holders to profits", "Government bonds", "Fixed-rate certificates of deposit"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What does 'scaling a business' mean?", options: ["Reducing company size", "Growing the business while increasing revenue faster than costs", "Measuring employee performance", "Standardizing product quality"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "Which global organization provides financial assistance to developing countries?", options: ["WTO", "IMF", "UNESCO", "OPEC"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the primary purpose of insurance in business?", options: ["To generate investment returns", "To protect against financial losses from unforeseen events", "To replace the need for emergency funds", "To reduce corporate taxes"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is a convertible note in startup funding?", options: ["A government grant", "A short-term debt that converts to equity at a later fundraising round", "A company loan from a bank", "A fixed-income bond"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is the meaning of 'unicorn' in the startup world?", options: ["A rare antique business", "A startup valued at over $1 billion", "A non-profit organization", "A business owned by a single person"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "What is the purpose of a non-compete agreement?", options: ["To prevent employees from working for competitors for a defined period", "To agree not to reduce prices", "To prohibit advertising to competitors' customers", "To prevent partners from leaving a firm"], correctIndex: 0, category: "Business", difficulty: "medium" },
        { question: "What does the term 'working capital' mean?", options: ["The salaries of active employees", "Current assets minus current liabilities, showing short-term financial health", "Annual capital investment budget", "Equity contributions by working partners"], correctIndex: 1, category: "Business", difficulty: "medium" },
        { question: "Which industry does OPEC primarily regulate?", options: ["Mining", "Oil and gas", "Banking", "Agriculture"], correctIndex: 1, category: "Business", difficulty: "easy" },
        { question: "What is Amazon's primary source of profit?", options: ["Online retail sales", "Amazon Web Services (AWS)", "Advertising", "Physical stores"], correctIndex: 1, category: "Business", difficulty: "hard" },
        { question: "What is a supply chain?", options: ["A chain of retail stores", "The network of businesses involved in producing and delivering a product", "A loan chain from bank to business", "A manufacturing assembly line"], correctIndex: 1, category: "Business", difficulty: "easy" },
      ],
    },
    {
      category: "General Knowledge",
      questions: [
        { question: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Brisbane"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "How many continents are there on Earth?", options: ["5", "6", "7", "8"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the chemical symbol for water?", options: ["O2", "H2O", "CO2", "HO"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "Who painted the Mona Lisa?", options: ["Michelangelo", "Raphael", "Leonardo da Vinci", "Caravaggio"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the smallest country in the world?", options: ["Monaco", "San Marino", "Vatican City", "Liechtenstein"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "How many bones are in the adult human body?", options: ["196", "206", "216", "186"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the capital of Japan?", options: ["Osaka", "Kyoto", "Hiroshima", "Tokyo"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "Which planet is closest to the Sun?", options: ["Venus", "Earth", "Mercury", "Mars"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the speed of light?", options: ["150,000 km/s", "200,000 km/s", "300,000 km/s", "400,000 km/s"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "Who wrote 'Romeo and Juliet'?", options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Homer"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the longest river in the world?", options: ["Amazon", "Mississippi", "Nile", "Yangtze"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the largest ocean on Earth?", options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What element does 'O' represent on the periodic table?", options: ["Osmium", "Oxygen", "Oganesson", "Oxide"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the tallest mountain in the world?", options: ["K2", "Mount Everest", "Kangchenjunga", "Lhotse"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the currency of the United Kingdom?", options: ["Euro", "Dollar", "Pound Sterling", "Franc"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "How many days are there in a leap year?", options: ["365", "366", "367", "364"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "In what year did World War II end?", options: ["1943", "1944", "1945", "1946"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the capital of France?", options: ["Lyon", "Marseille", "Paris", "Bordeaux"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Which gas makes up most of Earth's atmosphere?", options: ["Oxygen", "Carbon dioxide", "Hydrogen", "Nitrogen"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the human body's largest organ?", options: ["Liver", "Lungs", "Skin", "Brain"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Who invented the telephone?", options: ["Thomas Edison", "Alexander Graham Bell", "Nikola Tesla", "Guglielmo Marconi"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "How many planets are in our solar system?", options: ["7", "8", "9", "10"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the symbol for gold on the periodic table?", options: ["Go", "Gd", "Au", "Ag"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the capital of Germany?", options: ["Munich", "Hamburg", "Frankfurt", "Berlin"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "Who was the first person to walk on the Moon?", options: ["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "Alan Shepard"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the square root of 144?", options: ["11", "12", "13", "14"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "Which country has the largest population in the world?", options: ["India", "USA", "China", "Indonesia"], correctIndex: 0, category: "General Knowledge", difficulty: "easy" },
        { question: "What is photosynthesis?", options: ["The process by which animals digest food", "The process by which plants make food using sunlight", "The conversion of water to oxygen", "The breathing process in plants"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "How many strings does a standard guitar have?", options: ["4", "5", "6", "7"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "In which city is the Eiffel Tower located?", options: ["Rome", "London", "Berlin", "Paris"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the chemical formula for table salt?", options: ["KCl", "NaCl", "NaOH", "CaCl2"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "How many chambers does a human heart have?", options: ["2", "3", "4", "5"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Which country gifted the Statue of Liberty to the USA?", options: ["England", "Germany", "France", "Spain"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the world's largest desert?", options: ["Gobi", "Sahara", "Arabian", "Antarctic"], correctIndex: 3, category: "General Knowledge", difficulty: "hard" },
        { question: "In what year did the Titanic sink?", options: ["1910", "1912", "1914", "1916"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What blood type is the universal donor?", options: ["A+", "B−", "AB+", "O−"], correctIndex: 3, category: "General Knowledge", difficulty: "medium" },
        { question: "Which country invented the compass?", options: ["Egypt", "India", "China", "Greece"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What does DNA stand for?", options: ["Deoxyribonucleic Acid", "Dinitrogen Acid", "Dynamic Natural Amino acid", "Dual Nucleic Acid"], correctIndex: 0, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the most spoken language in the world by total speakers?", options: ["Spanish", "English", "Mandarin Chinese", "Hindi"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "Who developed the theory of general relativity?", options: ["Isaac Newton", "Stephen Hawking", "Albert Einstein", "Niels Bohr"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "How many colors are in a rainbow?", options: ["5", "6", "7", "8"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the hardest natural substance on Earth?", options: ["Quartz", "Topaz", "Corundum", "Diamond"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "Which organ produces insulin?", options: ["Liver", "Kidneys", "Pancreas", "Stomach"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the capital of Brazil?", options: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "How many zeros are in one million?", options: ["4", "5", "6", "7"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the boiling point of water in Celsius?", options: ["90°C", "95°C", "100°C", "105°C"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Which continent is the Sahara Desert located on?", options: ["Asia", "South America", "Africa", "Australia"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the most abundant metal in Earth's crust?", options: ["Iron", "Copper", "Aluminium", "Silicon"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "How long does it take light to travel from the Sun to Earth?", options: ["4 minutes", "8 minutes", "15 minutes", "30 minutes"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the capital of Canada?", options: ["Toronto", "Vancouver", "Ottawa", "Montreal"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "Which vitamin is produced when skin is exposed to sunlight?", options: ["Vitamin A", "Vitamin B12", "Vitamin C", "Vitamin D"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "How many teeth does an adult human have?", options: ["28", "30", "32", "34"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the powerhouse of the cell?", options: ["Nucleus", "Ribosome", "Mitochondria", "Chloroplast"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is H2O commonly known as?", options: ["Hydrogen gas", "Steam only", "Water", "Hydrogen peroxide"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What does the Roman numeral X represent?", options: ["5", "8", "10", "12"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the largest planet in the solar system?", options: ["Saturn", "Uranus", "Neptune", "Jupiter"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "Who invented the light bulb?", options: ["Benjamin Franklin", "Nikola Tesla", "Thomas Edison", "Alexander Graham Bell"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "How many chambers does the human lung have?", options: ["1 left, 2 right", "2 left, 3 right", "2 left, 2 right", "3 left, 2 right"], correctIndex: 1, category: "General Knowledge", difficulty: "hard" },
        { question: "Which city is known as the Big Apple?", options: ["Chicago", "Los Angeles", "Boston", "New York City"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the capital of Russia?", options: ["St. Petersburg", "Novosibirsk", "Moscow", "Vladivostok"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What force keeps planets in orbit around the Sun?", options: ["Magnetic force", "Nuclear force", "Gravity", "Electrostatic force"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the most common blood type in humans?", options: ["A+", "B+", "O+", "AB+"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What language is spoken in Brazil?", options: ["Spanish", "Portuguese", "French", "Italian"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the distance around a circle called?", options: ["Diameter", "Radius", "Circumference", "Area"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the primary function of white blood cells?", options: ["Transporting oxygen", "Clotting blood", "Fighting infection", "Producing hormones"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the world's most visited city by international tourists?", options: ["New York", "Paris", "London", "Dubai"], correctIndex: 1, category: "General Knowledge", difficulty: "hard" },
        { question: "Which element has the atomic number 1?", options: ["Helium", "Lithium", "Hydrogen", "Carbon"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What does 'pH' stand for?", options: ["Potential Hydrogen", "Physical Hardness", "Phosphate Hydroxide", "Pure Hydration"], correctIndex: 0, category: "General Knowledge", difficulty: "medium" },
        { question: "How many sides does a triangle have?", options: ["2", "3", "4", "5"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "In what country is the Great Barrier Reef located?", options: ["USA", "Brazil", "Australia", "New Zealand"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What instrument measures atmospheric pressure?", options: ["Thermometer", "Hygrometer", "Anemometer", "Barometer"], correctIndex: 3, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the largest land animal?", options: ["Giraffe", "Hippopotamus", "African Elephant", "Rhinoceros"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Which country is the Amazon Rainforest primarily located in?", options: ["Colombia", "Peru", "Venezuela", "Brazil"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the currency of Japan?", options: ["Won", "Yuan", "Yen", "Baht"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Who wrote 'Harry Potter'?", options: ["Roald Dahl", "J.K. Rowling", "C.S. Lewis", "Philip Pullman"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "In which year did the Berlin Wall fall?", options: ["1987", "1989", "1991", "1993"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the process by which solids turn directly into gas?", options: ["Evaporation", "Condensation", "Sublimation", "Melting"], correctIndex: 2, category: "General Knowledge", difficulty: "hard" },
        { question: "What does Wi-Fi stand for?", options: ["Wireless Fidelity", "Wide Frequency", "Wireless Filing", "Worldwide Internet"], correctIndex: 0, category: "General Knowledge", difficulty: "medium" },
        { question: "How many bytes are in a kilobyte?", options: ["100", "512", "1024", "2048"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the capital of India?", options: ["Mumbai", "Kolkata", "Chennai", "New Delhi"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the study of stars and planets called?", options: ["Astrology", "Meteorology", "Geology", "Astronomy"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "Who was the first woman to win a Nobel Prize?", options: ["Dorothy Hodgkin", "Rosalind Franklin", "Marie Curie", "Lise Meitner"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the main ingredient in guacamole?", options: ["Tomato", "Mango", "Avocado", "Lime"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "Which country has the most time zones?", options: ["Russia", "USA", "China", "France"], correctIndex: 3, category: "General Knowledge", difficulty: "hard" },
        { question: "What is the square root of 256?", options: ["14", "15", "16", "17"], correctIndex: 2, category: "General Knowledge", difficulty: "medium" },
        { question: "Which planet is known as the Red Planet?", options: ["Jupiter", "Venus", "Saturn", "Mars"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What does the acronym USB stand for?", options: ["Universal Serial Bus", "Unified System Board", "Ultra Speed Broadband", "Universal Storage Box"], correctIndex: 0, category: "General Knowledge", difficulty: "medium" },
        { question: "How many days does it take Earth to orbit the Sun?", options: ["355", "360", "365.25", "370"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "In what country is Mount Kilimanjaro?", options: ["Kenya", "Tanzania", "Uganda", "Ethiopia"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "What is the study of the human mind and behavior?", options: ["Sociology", "Anthropology", "Philosophy", "Psychology"], correctIndex: 3, category: "General Knowledge", difficulty: "easy" },
        { question: "What vitamin is also known as ascorbic acid?", options: ["Vitamin A", "Vitamin B", "Vitamin C", "Vitamin D"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
        { question: "What is the national currency of the European Union's common market?", options: ["Franc", "Euro", "Mark", "Lira"], correctIndex: 1, category: "General Knowledge", difficulty: "easy" },
        { question: "How many symphonies did Beethoven compose?", options: ["7", "8", "9", "10"], correctIndex: 2, category: "General Knowledge", difficulty: "hard" },
        { question: "What is the freezing point of water in Fahrenheit?", options: ["0°F", "32°F", "64°F", "100°F"], correctIndex: 1, category: "General Knowledge", difficulty: "medium" },
        { question: "Which country has the most natural lakes?", options: ["Brazil", "Russia", "USA", "Canada"], correctIndex: 3, category: "General Knowledge", difficulty: "hard" },
        { question: "What is the world's largest country by area?", options: ["Canada", "China", "Russia", "USA"], correctIndex: 2, category: "General Knowledge", difficulty: "easy" },
      ],
    },
    {
      category: "Animals",
      questions: [
        { question: "What is the largest animal on Earth?", options: ["African Elephant", "Blue Whale", "Sperm Whale", "Whale Shark"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "How many legs does a spider have?", options: ["6", "8", "10", "12"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "What do you call a group of lions?", options: ["Pack", "Herd", "Pride", "Flock"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What is the fastest land animal?", options: ["Lion", "Cheetah", "Pronghorn Antelope", "Greyhound"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "Which bird cannot fly?", options: ["Eagle", "Flamingo", "Ostrich", "Crane"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What is a baby kangaroo called?", options: ["Cub", "Pup", "Calf", "Joey"], correctIndex: 3, category: "Animals", difficulty: "easy" },
        { question: "Which animal has the longest lifespan?", options: ["Galapagos Tortoise", "Greenland Shark", "Ocean Quahog Clam", "Bowhead Whale"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "What is the national bird of the USA?", options: ["Golden Eagle", "Bald Eagle", "American Robin", "Peregrine Falcon"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "How many hearts does an octopus have?", options: ["1", "2", "3", "4"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which animal is known to be the most intelligent after humans?", options: ["Dogs", "Dolphins", "Chimpanzees", "Crows"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "What is the only mammal capable of true flight?", options: ["Flying squirrel", "Flying lemur", "Bat", "Sugar glider"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "How do sea horses reproduce?", options: ["Both parents share egg incubation", "The male carries and gives birth to the young", "The female carries them in her mouth", "They lay eggs in coral"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the gestation period of an elephant?", options: ["6 months", "12 months", "18 months", "22 months"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "Which animal produces the loudest sound?", options: ["Elephant", "Blue Whale", "Sperm Whale", "Lion"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the largest species of big cat?", options: ["Lion", "Leopard", "Tiger", "Jaguar"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What animal is the symbol of the World Wildlife Fund (WWF)?", options: ["Tiger", "Polar Bear", "Giant Panda", "Snow Leopard"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "Which fish is known for changing gender during its lifetime?", options: ["Salmon", "Clownfish", "Barracuda", "Tuna"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is a group of crows called?", options: ["A flock", "A murder", "A colony", "A parliament"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "How many species of penguins exist?", options: ["9", "13", "18", "24"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "Which animal has the strongest bite force?", options: ["Lion", "Hippopotamus", "Nile Crocodile", "Spotted Hyena"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "What is the main diet of a koala?", options: ["Bamboo", "Eucalyptus leaves", "Fruits and berries", "Bark and roots"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "Which is the only continent where penguins live in the wild?", options: ["The Arctic", "Antarctica (and nearby regions)", "South America only", "Africa"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What color is a polar bear's skin?", options: ["White", "Pink", "Black", "Grey"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "Which animal has the most teeth?", options: ["Shark", "Catfish", "Snail (over 25,000 teeth)", "Crocodile"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "How long can a snail sleep continuously?", options: ["1 day", "1 week", "1 month", "3 years"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "What is the largest reptile?", options: ["Komodo dragon", "Nile Monitor Lizard", "Saltwater Crocodile", "Anaconda"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which animal has fingerprints almost identical to humans?", options: ["Orangutan", "Gorilla", "Chimpanzee", "Koala"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "What is a group of fish called?", options: ["A pod", "A school", "A colony", "A flock"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "Which animal can see ultraviolet light?", options: ["Dogs", "Eagles", "Bees", "Cats"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the correct term for a group of wolves?", options: ["Pack", "Herd", "Pride", "Colony"], correctIndex: 0, category: "Animals", difficulty: "easy" },
        { question: "How do butterflies taste?", options: ["With their tongues", "With their antennae", "With their feet", "With their wings"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which is the only bird known to fly backwards?", options: ["Swallow", "Hummingbird", "Swift", "Kingfisher"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What percentage of their life do cats spend sleeping?", options: ["30%", "50%", "70%", "85%"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which shark species is the most dangerous to humans?", options: ["Hammerhead", "Whale Shark", "Great White Shark", "Bull Shark"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the only mammal that can truly hibernate?", options: ["Bear", "Groundhog", "Hedgehog", "Many small mammals including dormice and hedgehogs"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "How many eyes does a bee have?", options: ["2", "3", "4", "5"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "What is the world's most venomous animal?", options: ["King Cobra", "Box Jellyfish", "Inland Taipan", "Blue-ringed Octopus"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "Which animal has the longest migration?", options: ["Humpback Whale", "Bar-tailed Godwit", "Arctic Tern", "Monarch Butterfly"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "What is the largest bird by wingspan?", options: ["Bald Eagle", "Albatross", "Andean Condor", "Wandering Albatross"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "Which animal is known to mourn its dead?", options: ["Wolves", "Chimpanzees", "Elephants", "All of the above"], correctIndex: 3, category: "Animals", difficulty: "medium" },
        { question: "What do pandas primarily eat?", options: ["Fruit and roots", "Bamboo", "Fish", "Insects and leaves"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "What type of animal is a Komodo dragon?", options: ["Snake", "Crocodile", "Lizard", "Tortoise"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "Which animal has a tongue longer than its body?", options: ["Giraffe", "Chameleon", "Anteater", "Salamander"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is a group of owls called?", options: ["A flock", "A murder", "A parliament", "A colony"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "How does a jellyfish move through water?", options: ["By using fins", "By contracting and expanding its bell", "By waving its tentacles", "By jet propulsion using a siphon"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the only continent without native snakes?", options: ["Antarctica", "Iceland", "Ireland", "New Zealand"], correctIndex: 0, category: "Animals", difficulty: "hard" },
        { question: "What is the largest species of penguin?", options: ["Rockhopper Penguin", "King Penguin", "Emperor Penguin", "Macaroni Penguin"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "How many legs does a crab have?", options: ["6", "8", "10", "12"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What adaptation helps a camel survive in the desert?", options: ["Storing water in its hump", "Very thick fur to stay cool", "Storing fat in its hump for energy", "Excreting salt through its skin"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the collective name for a group of cats?", options: ["Pack", "Clowder", "Pounce", "Both B and C"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "Which animal has the best memory?", options: ["Dolphin", "Elephant", "Chimpanzee", "Crow"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "Which animal is responsible for the most human deaths annually?", options: ["Crocodiles", "Hippopotamus", "Mosquito", "Lion"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the process by which snakes shed their skin called?", options: ["Metamorphosis", "Ecdysis", "Molting", "Castration"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "Which is the only primate besides humans that regularly walks upright?", options: ["Orangutan", "Gorilla", "Gibbon", "Bonobo"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "What do sea otters do to stay warm?", options: ["Dive deep to warmer water", "Huddle together and hold hands while floating", "Coat their fur with fish oil", "Move to warmer regions in winter"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the largest living structure on Earth?", options: ["Amazon Rainforest", "Great Barrier Reef", "Giant Kelp Forests", "Siberian Boreal Forest"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "How do dogs primarily communicate?", options: ["Primarily through barking", "Through a combination of vocalizations, body language, and scent", "Mainly through facial expressions", "Primarily through tail movement only"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the only US state with its own indigenous primate?", options: ["Hawaii", "Alaska", "Florida", "No US state has native primates"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "What is the incubation period of a chicken egg?", options: ["14 days", "17 days", "21 days", "28 days"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which whale is the largest toothed animal?", options: ["Blue Whale", "Orca (Killer Whale)", "Sperm Whale", "Humpback Whale"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is a group of flamingos called?", options: ["A flock", "A colony", "A flamboyance", "A chorus"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which reptile can regenerate its tail?", options: ["Crocodile", "Turtle", "Gecko", "Iguana"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the main purpose of a chameleon's color change?", options: ["To attract mates only", "To camouflage from predators", "To regulate body temperature and communicate mood", "To warn predators"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the fastest bird in a dive?", options: ["Eagle", "Hawk", "Peregrine Falcon", "Swift"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What is the difference between a poisonous and venomous animal?", options: ["They are the same thing", "Venomous animals inject toxins; poisonous ones are harmful when touched or eaten", "Poisonous animals inject toxins; venomous are harmful when eaten", "Only venomous animals can kill humans"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is a baby swan called?", options: ["Cygnet", "Duckling", "Chick", "Swanlet"], correctIndex: 0, category: "Animals", difficulty: "medium" },
        { question: "How many chambers does a cow's stomach have?", options: ["1", "2", "3", "4"], correctIndex: 3, category: "Animals", difficulty: "medium" },
        { question: "Which animal is known to laugh?", options: ["Dogs and wolves", "Hyenas and rats", "Chimpanzees", "Dolphins"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "What is the study of insects called?", options: ["Ornithology", "Herpetology", "Entomology", "Ichthyology"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which animal builds the largest known nest structure?", options: ["Bald Eagle", "Sociable Weaver", "Stork", "Osprey"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "What is the color of a hippo's sweat?", options: ["Clear", "White", "Reddish-pink", "Yellow"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "Which bird is known for its ability to mimic sounds?", options: ["Parrot and Lyrebird", "Crow", "Nightingale", "Robin"], correctIndex: 0, category: "Animals", difficulty: "easy" },
        { question: "What unique ability does the archerfish have?", options: ["It can walk on land", "It shoots water jets to knock prey from above the water's surface", "It can change color like a cuttlefish", "It generates electric fields"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "How do sharks detect prey in the ocean?", options: ["Vision only", "Hearing and lateral line", "Electroreception and smell", "All senses combined"], correctIndex: 3, category: "Animals", difficulty: "medium" },
        { question: "What animal's cry is known as braying?", options: ["Horse", "Donkey", "Mule", "Zebra"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "Which is the world's largest living reptile?", options: ["Nile Crocodile", "Komodo Dragon", "Saltwater Crocodile", "Leatherback Sea Turtle"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "Which of these animals is an invertebrate?", options: ["Shark", "Salamander", "Starfish", "Axolotl"], correctIndex: 2, category: "Animals", difficulty: "medium" },
        { question: "What is the typical lifespan of a domestic cat?", options: ["5–8 years", "10–12 years", "12–18 years", "20–25 years"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "Which animal produces silk?", options: ["Spider and Silkworm", "Honeybee", "Beetle", "Moth only"], correctIndex: 0, category: "Animals", difficulty: "easy" },
        { question: "What is a group of geese on land called?", options: ["A flock", "A gaggle", "A skein", "A herd"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the only mammal known to have a poisonous bite (venomous spur)?", options: ["Shrew", "Mole", "Platypus", "Hedgehog"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "Which animals are classified as pachyderms?", options: ["Elephants, rhinos, and hippos", "Elephants and rhinos only", "All large mammals", "Elephants only"], correctIndex: 0, category: "Animals", difficulty: "medium" },
        { question: "What is the term for animals that are active at night?", options: ["Diurnal", "Crepuscular", "Nocturnal", "Cathemeral"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What is a cephalopod?", options: ["A type of fish", "An invertebrate with a prominent head and tentacles (squid, octopus, cuttlefish)", "A crustacean", "A type of jellyfish"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "Which animal has three eyelids?", options: ["Horse", "Camel", "Cat", "Dog"], correctIndex: 2, category: "Animals", difficulty: "hard" },
        { question: "Which mammal is known to use tools in the wild most regularly?", options: ["Orangutans", "Chimpanzees", "Dolphins", "Crows (not mammal but notable)"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the heaviest insect in the world?", options: ["Goliath Beetle", "Titan Beetle", "Giant Weta", "Actaeon Beetle"], correctIndex: 0, category: "Animals", difficulty: "hard" },
        { question: "Which fish can walk on land using its fins?", options: ["Mudskipper", "Lungfish", "Climbing Perch", "All of the above"], correctIndex: 3, category: "Animals", difficulty: "hard" },
        { question: "What does a carnivore eat?", options: ["Only plants", "Only meat", "Both plants and animals", "Only insects"], correctIndex: 1, category: "Animals", difficulty: "easy" },
        { question: "How do horses communicate primarily?", options: ["Vocalizations", "Ear position, body posture, and tail movement", "Stomping", "Facial expressions alone"], correctIndex: 1, category: "Animals", difficulty: "medium" },
        { question: "What is the world's largest rodent?", options: ["Beaver", "Porcupine", "Nutria", "Capybara"], correctIndex: 3, category: "Animals", difficulty: "medium" },
        { question: "Which animal can live without water the longest?", options: ["Camel", "Kangaroo Rat", "Gila Monster", "Jerboa"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "What are the four main types of teeth humans have?", options: ["Canines, molars, incisors, bicuspids (premolars)", "Fangs, grinders, biters, crushers", "Front, side, back, wisdom", "Pointed, flat, long, short"], correctIndex: 0, category: "Animals", difficulty: "medium" },
        { question: "Which bird is associated with delivering babies in European folklore?", options: ["Robin", "Crane", "Stork", "Dove"], correctIndex: 2, category: "Animals", difficulty: "easy" },
        { question: "What is special about the mimic octopus?", options: ["It can grow up to 10 meters", "It can impersonate other sea animals like flatfish and lionfish", "It changes color to match the rainbow", "It can survive out of water for 24 hours"], correctIndex: 1, category: "Animals", difficulty: "hard" },
        { question: "What is the largest spider in the world?", options: ["Goliath Birdeater Tarantula", "Huntsman Spider", "Giant Wolf Spider", "Brazilian Wandering Spider"], correctIndex: 0, category: "Animals", difficulty: "medium" },
        { question: "Which group of animals is called a 'crash'?", options: ["Hippos", "Rhinos", "Buffalos", "Elephants"], correctIndex: 1, category: "Animals", difficulty: "hard" },
      ],
    },
  ];

  const insertFn = (q: Q) => ({
    question: q.question,
    options: q.options as unknown as Record<string, unknown>,
    correctIndex: q.correctIndex,
    category: q.category,
    difficulty: q.difficulty,
  });

  for (const { category, questions: catQ } of newCategorySeeds) {
    const existing = await db.select({ n: sql<number>`count(*)` }).from(triviaQuestionsTable)
      .where(eq(triviaQuestionsTable.category, category));
    if (Number(existing[0].n) === 0) {
      await db.insert(triviaQuestionsTable).values(catQ.map(insertFn));
    }
  }
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
    // Atomic status transition — only proceed if we own the active→completed update.
    // If another concurrent call already settled this game, rows will be empty and
    // we skip all payouts, preventing double crediting.
    const settled = await tx.update(triviaGamesTable).set({
      status: "completed",
      player1Score: p1Score,
      player2Score: p2Score,
      winnerId,
      endedAt: new Date(),
    }).where(and(eq(triviaGamesTable.id, gameId), eq(triviaGamesTable.status, "active")))
      .returning({ id: triviaGamesTable.id });
    if (settled.length === 0) return; // already settled by a concurrent call — skip all payouts

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
// GET /api/trivia/categories — list categories that have questions
// ---------------------------------------------------------------------------
router.get("/trivia/categories", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.selectDistinct({ category: triviaQuestionsTable.category })
      .from(triviaQuestionsTable)
      .where(eq(triviaQuestionsTable.isActive, true));
    const existing = new Set(rows.map(r => r.category));

    const DISPLAY_CATEGORIES = [
      { id: "All", label: "All Topics" },
      { id: "Crypto", label: "Crypto" },
      { id: "Agriculture", label: "Agriculture" },
      { id: "Movies", label: "Movies" },
      { id: "Business", label: "Business" },
      { id: "General Knowledge", label: "General Knowledge" },
      { id: "Animals", label: "Animals" },
    ];

    // "All" is always available; "Crypto" is available if any crypto sub-category exists
    const cryptoAvailable = [...existing].some(c => CRYPTO_CATEGORIES.has(c));

    const available = DISPLAY_CATEGORIES.filter(cat => {
      if (cat.id === "All") return true;
      if (cat.id === "Crypto") return cryptoAvailable;
      return existing.has(cat.id);
    });

    res.json(available);
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
    const { entryFee, category } = req.body as { entryFee?: unknown; category?: unknown };
    const fee = Number(entryFee);
    const cat = typeof category === "string" ? category.trim() : "All";

    if (!fee || fee <= 0) { res.status(400).json({ error: "entryFee must be a positive number" }); return; }

    const settings = await getTriviaSettings();
    if (!settings.enabled) { res.status(403).json({ error: "Trivia is currently disabled" }); return; }
    if (fee < settings.minFee || fee > settings.maxFee) {
      res.status(400).json({ error: `Entry fee must be between ${settings.minFee} and ${settings.maxFee} coins` }); return;
    }

    // Pick 10 random questions from the selected category
    const questionIds = await pickQuestionIds(cat, 10);
    if (questionIds.length < 10) { res.status(500).json({ error: "Not enough questions in this category" }); return; }

    // Bot answers at ~65% accuracy — must be index-aligned with questionIds
    const allQWithAnswers = await db.select({
      id: triviaQuestionsTable.id,
      correctIndex: triviaQuestionsTable.correctIndex,
      options: triviaQuestionsTable.options,
    }).from(triviaQuestionsTable)
      .where(inArray(triviaQuestionsTable.id, questionIds));

    // inArray does not guarantee DB return order matches questionIds, so key by ID first
    const qById = new Map(allQWithAnswers.map(q => [q.id, q]));
    // Adaptive difficulty: bot accuracy is randomised per game between 40–60%
    // so the player's expected win rate averages ~50% with no guaranteed wins.
    const botAccuracy = 0.40 + Math.random() * 0.20;
    const botAnswers = questionIds.map(qid => {
      const q = qById.get(qid)!;
      const isCorrect = Math.random() < botAccuracy;
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
    const { entryFee, category } = req.body as { entryFee?: unknown; category?: unknown };
    const fee = Number(entryFee);
    const cat = typeof category === "string" ? category.trim() : "All";
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
        category: cat,
      }).returning();
      challengeId = challenge.id;
    });

    res.status(201).json({ id: challengeId, entryFee: fee, status: "open", category: cat });
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

    // Pick 10 random questions using the challenge's category
    const questionIds = await pickQuestionIds(challenge.category ?? "All", 10);
    if (questionIds.length < 10) { res.status(500).json({ error: "Not enough questions in this category" }); return; }

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

    // Fetch correct answer for per-question reveal on the client
    const questionId = questionIds[qIdx];
    const [qRow] = await db.select({ correctIndex: triviaQuestionsTable.correctIndex })
      .from(triviaQuestionsTable).where(eq(triviaQuestionsTable.id, questionId)).limit(1);

    const done = newAnswers.length >= questionIds.length;
    res.json({ recorded: true, answeredCount: newAnswers.length, done, correctIndex: qRow?.correctIndex ?? null });

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

    // Only include correctIndex when game is completed — prevents answer leakage during active play
    const safeQuestions = game.status === "completed"
      ? ordered.map(q => ({ ...q, options: q.options as string[] }))
      : ordered.map(({ correctIndex: _ci, ...rest }) => ({ ...rest, options: rest.options as string[] }));

    res.json({
      ...game,
      questions: safeQuestions,
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
// EventSource cannot set custom headers, so we also accept ?token=<jwt>
// ---------------------------------------------------------------------------
router.get("/trivia/events/:id", async (req: Request, res: Response): Promise<void> => {
  // Promote ?token= query param to Authorization header so inline auth works
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

  const [game] = await db.select({ player1Id: triviaGamesTable.player1Id, player2Id: triviaGamesTable.player2Id })
    .from(triviaGamesTable).where(eq(triviaGamesTable.id, gameId)).limit(1);
  if (!game) { res.status(404).json({ error: "Game not found" }); return; }
  if (game.player1Id !== uid && game.player2Id !== uid) {
    res.status(403).json({ error: "Not a participant" }); return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const remove = addSseListener(gameId, data => {
    res.write(`data: ${data}\n\n`);
  });

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(keepAlive); remove(); });
});

export default router;
