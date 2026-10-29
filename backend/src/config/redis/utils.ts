import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";
import { NO_SESSION, peerStorageKey } from "./constants.js";
import { Level } from "./types.js";

const areValidStrings = (...values: unknown[]): boolean => {
  return values.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
};

export const redisKeyExists = async (key: string): Promise<boolean> => {
  return (await redisClient.exists(key)) === 1;
};

/**
 * Resolves the session a peer currently belongs to.
 *
 * Returns null for both "unknown peer" and the `NOT_IN_SESSION` placeholder,
 * which used to be read back as if it were a session id.
 */
export const getPeerSessionId = async (
  peerId: string,
  context: string,
): Promise<string | null> => {
  if (!areValidStrings(peerId, context)) {
    logger.error(
      `[VALIDATION] :: [ERROR] :: [getPeerSessionId] :: KEY OR CONTEXT INVALID TYPE :: ${peerId}`,
    );
    throw new Error("invalid type");
  }

  const value = await redisClient.get(peerStorageKey(peerId));
  if (!value || value === NO_SESSION) return null;
  return value;
};

export const assertValidStrings = (
  values: unknown[],
  context: string,
): void => {
  if (!areValidStrings(...values)) {
    logger.error(
      `[VALIDATION] :: [ERROR] :: [assertValidStrings] :: [${context}] :: INVALID STRINGS :: ${values.join(", ")}`,
    );
    throw new Error("invalid value received");
  }
};

export const logRedis = (
  level: Level,
  context?: string,
  message?: string,
  meta?: unknown,
): void => {
  const payload =
    meta === undefined ? {} : meta instanceof Error ? { err: meta } : { meta };

  if (level === "error") {
    logger.error(payload, `[REDIS] :: [ERROR] :: [${context}] :: ${message}`);
  }
  if (level === "success") {
    logger.info(payload, `[REDIS] :: [SUCCESS] :: [${context}] :: ${message}`);
  }
  if (level === "warn") {
    logger.warn(payload, `[REDIS] :: [WARN] :: [${context}] :: ${message}`);
  }
};
