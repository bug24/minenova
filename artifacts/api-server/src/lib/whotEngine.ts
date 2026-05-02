// WHOT card game engine — 2-player variant
// Deck: 5 suits × 14 values (1–14) + 5 WHOT-20 wild cards = 75 cards
// Action cards: 1=HoldOn (extra turn), 2=PickTwo, 5=PickThree, 8=Suspension, 14=GeneralMarket, 20=WHOT

export type Suit = "Circle" | "Triangle" | "Cross" | "Square" | "Star";
export type CardSuit = Suit | "WHOT";

export interface Card {
  suit: CardSuit;
  value: number;
}

export interface PlayerState {
  userId: number;
  hand: Card[];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  deck: Card[];
  discardPile: Card[];
  currentTurn: 0 | 1;
  calledSuit: Suit | null;
  pendingPickCount: number;
  status: "active" | "completed";
  winnerId: number | null;
  lastMoveAt: string | null;
}

// ---------------------------------------------------------------------------
// Deck building
// ---------------------------------------------------------------------------
const SUITS: Suit[] = ["Circle", "Triangle", "Cross", "Square", "Star"];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (let v = 1; v <= 14; v++) {
      cards.push({ suit, value: v });
    }
  }
  for (let i = 0; i < 5; i++) {
    cards.push({ suit: "WHOT", value: 20 });
  }
  return cards;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
export function createInitialState(player0Id: number, player1Id: number): GameState {
  let deck = shuffleDeck(buildDeck());

  // Deal 5 cards each
  const hand0 = deck.splice(0, 5);
  const hand1 = deck.splice(0, 5);

  // Flip top card; if it's WHOT-20, keep flipping until non-WHOT
  let discardTop: Card | undefined;
  while (deck.length > 0) {
    discardTop = deck.splice(0, 1)[0];
    if (discardTop.suit !== "WHOT") break;
    deck.push(discardTop);
  }
  if (!discardTop) throw new Error("Could not initialise WHOT deck");

  return {
    players: [
      { userId: player0Id, hand: hand0 },
      { userId: player1Id, hand: hand1 },
    ],
    deck,
    discardPile: [discardTop],
    currentTurn: 0,
    calledSuit: null,
    pendingPickCount: 0,
    status: "active",
    winnerId: null,
    lastMoveAt: null,
  };
}

// ---------------------------------------------------------------------------
// Card utilities
// ---------------------------------------------------------------------------
export function topCard(state: GameState): Card {
  return state.discardPile[state.discardPile.length - 1];
}

/** The effective suit to match against (calledSuit if WHOT is on top) */
export function effectiveSuit(state: GameState): Suit | "WHOT" {
  const top = topCard(state);
  if (top.suit === "WHOT" && state.calledSuit) return state.calledSuit;
  return top.suit;
}

/** Whether a card can be played on the current discard given state */
export function isPlayable(card: Card, state: GameState): boolean {
  // If there's a pending pick, only +2/+5 cards can cancel it (chain rule)
  if (state.pendingPickCount > 0) {
    return card.value === 2 || card.value === 5;
  }
  if (card.suit === "WHOT") return true;
  const top = topCard(state);
  const eSuit = effectiveSuit(state);
  // Match suit or value
  if (eSuit !== "WHOT" && card.suit === eSuit) return true;
  if (card.value === top.value) return true;
  return false;
}

export function getPlayableCards(state: GameState, playerIndex: 0 | 1): Card[] {
  return state.players[playerIndex].hand.filter(c => isPlayable(c, state));
}

// ---------------------------------------------------------------------------
// Reshuffle discard into deck when deck is exhausted
// ---------------------------------------------------------------------------
function ensureDeck(state: GameState): GameState {
  if (state.deck.length > 0) return state;
  if (state.discardPile.length <= 1) return state; // nothing to reshuffle

  const top = state.discardPile[state.discardPile.length - 1];
  const toShuffle = state.discardPile.slice(0, -1);
  return {
    ...state,
    deck: shuffleDeck(toShuffle),
    discardPile: [top],
  };
}

// ---------------------------------------------------------------------------
// Draw cards for a player
// ---------------------------------------------------------------------------
function drawCards(state: GameState, playerIndex: 0 | 1, count: number): GameState {
  let s = { ...state, deck: [...state.deck], players: [
    { ...state.players[0], hand: [...state.players[0].hand] },
    { ...state.players[1], hand: [...state.players[1].hand] },
  ] as [PlayerState, PlayerState] };

  for (let i = 0; i < count; i++) {
    s = ensureDeck(s);
    if (s.deck.length === 0) break;
    s.players[playerIndex].hand.push(s.deck.splice(0, 1)[0]);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Apply a played card — returns new state (winner detection included)
// ---------------------------------------------------------------------------
export function applyPlay(
  state: GameState,
  playerIndex: 0 | 1,
  cardIndex: number,
  calledSuit: Suit | null = null,
): GameState {
  const player = state.players[playerIndex];
  if (cardIndex < 0 || cardIndex >= player.hand.length) {
    throw Object.assign(new Error("Invalid card index"), { status: 400 });
  }
  const card = player.hand[cardIndex];
  if (!isPlayable(card, state)) {
    throw Object.assign(new Error("Card is not playable"), { status: 409 });
  }
  if (card.suit === "WHOT" && !calledSuit) {
    throw Object.assign(new Error("Must call a suit when playing WHOT"), { status: 400 });
  }

  const now = new Date().toISOString();

  // Remove card from hand
  let newHand = [...player.hand];
  newHand.splice(cardIndex, 1);

  let newState: GameState = {
    ...state,
    players: [
      { ...state.players[0], hand: playerIndex === 0 ? newHand : [...state.players[0].hand] },
      { ...state.players[1], hand: playerIndex === 1 ? newHand : [...state.players[1].hand] },
    ] as [PlayerState, PlayerState],
    discardPile: [...state.discardPile, card],
    calledSuit: card.suit === "WHOT" ? calledSuit : null,
    lastMoveAt: now,
  };

  // Check for win
  if (newHand.length === 0) {
    return {
      ...newState,
      status: "completed",
      winnerId: player.userId,
    };
  }

  const opponent: 0 | 1 = playerIndex === 0 ? 1 : 0;

  // Handle action cards
  switch (card.value) {
    case 1: {
      // Hold On — same player goes again
      return { ...newState, currentTurn: playerIndex, pendingPickCount: 0 };
    }
    case 2: {
      // Pick Two — chain or opponent draws
      const newPick = state.pendingPickCount + 2;
      return { ...newState, currentTurn: opponent, pendingPickCount: newPick };
    }
    case 5: {
      // Pick Three — chain or opponent draws
      const newPick = state.pendingPickCount + 3;
      return { ...newState, currentTurn: opponent, pendingPickCount: newPick };
    }
    case 8: {
      // Suspension — opponent loses their turn
      return { ...newState, currentTurn: playerIndex, pendingPickCount: 0 };
    }
    case 14: {
      // General Market — opponent draws 1
      newState = drawCards(newState, opponent, 1);
      return { ...newState, currentTurn: opponent, pendingPickCount: 0 };
    }
    default: {
      // Normal card — pass turn
      return { ...newState, currentTurn: opponent, pendingPickCount: 0 };
    }
  }
}

// ---------------------------------------------------------------------------
// Apply drawing (player has no playable card)
// ---------------------------------------------------------------------------
export function applyDraw(state: GameState, playerIndex: 0 | 1): GameState {
  const opponent: 0 | 1 = playerIndex === 0 ? 1 : 0;
  const now = new Date().toISOString();

  // If pending pick, resolve it
  if (state.pendingPickCount > 0) {
    let newState = drawCards(state, playerIndex, state.pendingPickCount);
    newState = { ...newState, pendingPickCount: 0, currentTurn: opponent, lastMoveAt: now };
    return newState;
  }

  // Normal draw: draw 1 card
  const newState = drawCards(state, playerIndex, 1);
  // After drawing, turn passes to opponent
  return { ...newState, currentTurn: opponent, lastMoveAt: now };
}

/**
 * Draw one card WITHOUT changing currentTurn.
 * Used by bot draw-retry logic: draw up to 3 cards before passing turn.
 */
export function drawOneCardRetain(state: GameState, playerIndex: 0 | 1): GameState {
  return drawCards(state, playerIndex, 1);
}

// ---------------------------------------------------------------------------
// Forfeit
// ---------------------------------------------------------------------------
export function forfeit(state: GameState, forfeitingUserId: number): GameState {
  const winnerId =
    state.players[0].userId === forfeitingUserId
      ? state.players[1].userId
      : state.players[0].userId;
  return { ...state, status: "completed", winnerId };
}

// ---------------------------------------------------------------------------
// Timeout check (3 min inactivity)
// ---------------------------------------------------------------------------
export function isTimedOut(state: GameState, timeoutMs = 3 * 60 * 1000): boolean {
  if (!state.lastMoveAt) return false;
  return Date.now() - new Date(state.lastMoveAt).getTime() > timeoutMs;
}

// ---------------------------------------------------------------------------
// Bot AI
// ---------------------------------------------------------------------------
export function botChooseAction(state: GameState): {
  action: "play" | "draw";
  cardIndex?: number;
  calledSuit?: Suit;
} {
  const botIndex = state.currentTurn;
  const hand = state.players[botIndex].hand;

  // Collect playable card indices
  const playable = hand
    .map((card, idx) => ({ card, idx }))
    .filter(({ card }) => isPlayable(card, state));

  if (playable.length === 0) {
    return { action: "draw" };
  }

  // Separate WHOT cards from normal cards
  const normalPlayable = playable.filter(({ card }) => card.suit !== "WHOT");
  const whotCards = playable.filter(({ card }) => card.suit === "WHOT");

  // Prefer normal cards first (save WHOT as last resort)
  const pool = normalPlayable.length > 0 ? normalPlayable : whotCards;

  // Priority: action cards first (2, 5, 8, 14, 1), then normal
  const actionValues = [2, 5, 8, 14, 1];
  for (const v of actionValues) {
    const match = pool.find(({ card }) => card.value === v);
    if (match) {
      if (match.card.suit === "WHOT") {
        return { action: "play", cardIndex: match.idx, calledSuit: botCallSuit(hand) };
      }
      return { action: "play", cardIndex: match.idx };
    }
  }

  // Play first available
  const chosen = pool[0];
  if (chosen.card.suit === "WHOT") {
    return { action: "play", cardIndex: chosen.idx, calledSuit: botCallSuit(hand) };
  }
  return { action: "play", cardIndex: chosen.idx };
}

function botCallSuit(hand: Card[]): Suit {
  const counts: Record<Suit, number> = {
    Circle: 0, Triangle: 0, Cross: 0, Square: 0, Star: 0,
  };
  for (const c of hand) {
    if (c.suit !== "WHOT") counts[c.suit as Suit]++;
  }
  const best = (Object.entries(counts) as [Suit, number][]).sort((a, b) => b[1] - a[1]);
  return best[0][0];
}
