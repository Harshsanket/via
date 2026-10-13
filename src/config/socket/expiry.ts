import { env } from "../env.js";
import { logger } from "../../utils/logger.js";
import type { ViaServer } from "./types.js";

interface SessionTimers {
  warning?: NodeJS.Timeout;
  expiry?: NodeJS.Timeout;
}

let io: ViaServer | null = null;
const timers = new Map<string, SessionTimers>();

/** Called once from initSocket, before any session can be created. */
export const initSessionExpiry = (server: ViaServer): void => {
  io = server;
};

export const clearSessionExpiry = (sessionId: string): void => {
  const entry = timers.get(sessionId);
  if (!entry) return;

  if (entry.warning) clearTimeout(entry.warning);
  if (entry.expiry) clearTimeout(entry.expiry);
  timers.delete(sessionId);
};

export const activeExpiryTimerCount = (): number => timers.size;

/**
 * Schedules the expiry pushes for a session room.
 *
 * Best effort by design: the timers live in this process, so with more than one
 * replica each would notify its own members, and Redis remains the authority on
 * whether the session is really gone. Timers are unref'd so they never hold the
 * process open, and re-scheduling always replaces the previous pair.
 */
export const scheduleSessionExpiry = (
  sessionId: string,
  ttlSeconds: number,
): void => {
  clearSessionExpiry(sessionId);

  if (!io) return;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;

  const expiresInMs = Math.round(ttlSeconds * 1000);
  const warningSeconds = env.sessionExpiryWarningSeconds;
  const entry: SessionTimers = {};

  if (warningSeconds > 0 && ttlSeconds > warningSeconds) {
    entry.warning = setTimeout(
      () => {
        io?.to(sessionId).emit("session:expiring", {
          sessionId,
          secondsRemaining: warningSeconds,
        });
        logger.info(
          `[EXPIRY] :: [SOCKET] :: session ${sessionId} expires in ${warningSeconds}s`,
        );
      },
      expiresInMs - warningSeconds * 1000,
    );
    entry.warning.unref();
  }

  entry.expiry = setTimeout(() => {
    timers.delete(sessionId);
    io?.to(sessionId).emit("session:expired", { sessionId });
    logger.warn(`[EXPIRY] :: [SOCKET] :: session ${sessionId} expired`);
  }, expiresInMs);
  entry.expiry.unref();

  timers.set(sessionId, entry);
};
