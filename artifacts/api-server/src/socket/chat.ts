import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { db, chatMessagesTable, chatBannedWordsTable, adminConfigTable, usersTable, chatMutesTable } from "@workspace/db";
import { desc, eq, sql, and, or, isNull, gt } from "drizzle-orm";
import { verifyToken } from "../lib/auth";
import { logger } from "../lib/logger";

const MAX_MESSAGE_LENGTH = 200;
const RATE_LIMIT_MS = 3000;
const HISTORY_COUNT = 50;

// In-memory rate limit map: userId -> last message timestamp
const lastMessageAt = new Map<number, number>();

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}

export async function isChatEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "chat_enabled"))
    .limit(1);
  return row ? row.value === "true" : true;
}

async function isMutedOrBanned(userId: number): Promise<boolean> {
  const now = new Date();
  const [mute] = await db
    .select({ id: chatMutesTable.id })
    .from(chatMutesTable)
    .where(and(
      eq(chatMutesTable.userId, userId),
      or(isNull(chatMutesTable.expiresAt), gt(chatMutesTable.expiresAt, now))
    ))
    .limit(1);
  return !!mute;
}

/** Disconnect all live sockets for a user with a mute notice */
export function kickMutedUser(userId: number): void {
  if (!_io) return;
  const socketIds = connectedUsers.get(userId);
  if (!socketIds) return;
  for (const sid of [...socketIds]) {
    const s = _io.sockets.sockets.get(sid);
    if (s) {
      s.emit("chat_error", { code: "muted", message: "You have been muted or banned from chat." });
    }
  }
}

async function getBannedPhrases(): Promise<string[]> {
  const rows = await db.select({ phrase: chatBannedWordsTable.phrase }).from(chatBannedWordsTable);
  return rows.map(r => r.phrase.toLowerCase());
}

async function getHistory() {
  const rows = await db
    .select({
      id: chatMessagesTable.id,
      userId: chatMessagesTable.userId,
      username: chatMessagesTable.username,
      message: chatMessagesTable.message,
      createdAt: chatMessagesTable.createdAt,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(chatMessagesTable)
    .leftJoin(usersTable, eq(chatMessagesTable.userId, usersTable.id))
    .orderBy(desc(chatMessagesTable.id))
    .limit(HISTORY_COUNT);
  return rows.map(r => ({ ...r, avatarUrl: r.avatarUrl ?? null })).reverse();
}

// Track connected socket count per userId for presence
const connectedUsers = new Map<number, Set<string>>(); // userId -> Set<socketId>

function onlineCount(): number {
  return connectedUsers.size;
}

// Singleton IO instance — accessible from admin routes
let _io: SocketIOServer | null = null;

export function getChatIO(): SocketIOServer | null {
  return _io;
}

/** Update socket.data avatarUrl for all live sockets of a given user */
export function updateUserAvatarOnSockets(userId: number, avatarUrl: string): void {
  if (!_io) return;
  const socketIds = connectedUsers.get(userId);
  if (!socketIds) return;
  for (const sid of socketIds) {
    const s = _io.sockets.sockets.get(sid);
    if (s) s.data["avatarUrl"] = avatarUrl;
  }
}

/** Called by admin when chat is toggled off: notify + disconnect all clients */
export function broadcastChatDisabled(): void {
  if (!_io) return;
  _io.emit("chat_disabled");
  // Disconnect every socket in the chat namespace after a short delay so the event
  // reaches the client before the connection drops.
  setTimeout(() => {
    _io?.disconnectSockets(true);
    connectedUsers.clear();
    _io?.emit("online_users_count", 0);
  }, 300);
}

export function attachChatSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socket.io",
  });
  _io = io;

  // ── Middleware: auth + chat_enabled gate ──────────────────────────────────
  io.use(async (socket, next) => {
    // 1. Check chat_enabled first — reject at the handshake level
    const enabled = await isChatEnabled();
    if (!enabled) {
      return next(new Error("chat_disabled"));
    }

    // 2. Verify JWT
    const token =
      (socket.handshake.auth as Record<string, string>)["token"] ??
      (socket.handshake.query["token"] as string);
    if (!token) return next(new Error("Unauthorized"));

    const userId = verifyToken(token);
    if (!userId) return next(new Error("Invalid token"));

    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, isSuspended: usersTable.isSuspended, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.isSuspended) return next(new Error("Unauthorized"));

    socket.data["userId"] = user.id;
    socket.data["username"] = user.username;
    socket.data["avatarUrl"] = user.avatarUrl ?? null;
    next();
  });

  io.on("connection", async (socket) => {
    const userId: number = socket.data["userId"];
    const username: string = socket.data["username"];
    const avatarUrl: string | null = socket.data["avatarUrl"] ?? null;

    // Presence tracking
    if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
    connectedUsers.get(userId)!.add(socket.id);
    io.emit("online_users_count", onlineCount());

    // Send history to this socket only
    try {
      const history = await getHistory();
      socket.emit("chat_history", history);
    } catch (err) {
      logger.error({ err }, "Failed to load chat history");
    }

    socket.on("send_message", async (rawMessage: unknown) => {
      if (typeof rawMessage !== "string") return;

      // Runtime guard: reject if chat was disabled after this socket connected
      const enabled = await isChatEnabled();
      if (!enabled) {
        socket.emit("chat_disabled");
        socket.disconnect(true);
        return;
      }

      // Mute / ban check
      const muted = await isMutedOrBanned(userId);
      if (muted) {
        socket.emit("chat_error", { code: "muted", message: "You are muted or banned from chat." });
        return;
      }

      // Rate limit
      const now = Date.now();
      const last = lastMessageAt.get(userId) ?? 0;
      if (now - last < RATE_LIMIT_MS) {
        socket.emit("chat_error", { code: "rate_limited", message: "You're sending messages too fast. Please wait a moment." });
        return;
      }

      // Sanitise
      const clean = stripHtml(rawMessage).slice(0, MAX_MESSAGE_LENGTH);
      if (!clean) return;

      // Banned-phrase check
      const banned = await getBannedPhrases();
      const lower = clean.toLowerCase();
      for (const phrase of banned) {
        if (lower.includes(phrase)) {
          socket.emit("chat_error", { code: "banned_word", message: "Your message contains a blocked phrase." });
          return;
        }
      }

      lastMessageAt.set(userId, now);

      // Persist
      let saved;
      try {
        [saved] = await db
          .insert(chatMessagesTable)
          .values({ userId, username, message: clean })
          .returning();
      } catch (err) {
        logger.error({ err }, "Failed to save chat message");
        socket.emit("chat_error", { code: "server_error", message: "Failed to send message." });
        return;
      }

      // Prune old messages async (keep last 200 in DB)
      db.execute(
        sql`DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 200)`
      ).catch(() => {});

      io.emit("message", {
        id: saved.id,
        userId,
        username,
        avatarUrl,
        message: clean,
        createdAt: saved.createdAt,
      });
    });

    socket.on("disconnect", () => {
      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) connectedUsers.delete(userId);
      }
      io.emit("online_users_count", onlineCount());
    });
  });

  return io;
}
