const TTL_MS = 15 * 60 * 1000;

interface PendingEntry {
  userId: number;
  expiresAt: number;
}

const pending = new Map<string, PendingEntry>();

function purgeExpired() {
  const now = Date.now();
  for (const [key, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(key);
  }
}

export function reserveUpload(objectPath: string, userId: number): void {
  purgeExpired();
  pending.set(objectPath, { userId, expiresAt: Date.now() + TTL_MS });
}

export function verifyUploadOwnership(objectPath: string, userId: number): boolean {
  purgeExpired();
  const entry = pending.get(objectPath);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) return false;
  return entry.userId === userId;
}

export function consumeUpload(objectPath: string): void {
  pending.delete(objectPath);
}
