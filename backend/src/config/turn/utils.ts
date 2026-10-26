import { logger } from "../../utils/logger.js";

export const logTurn = (
  level: "error" | "info" | "success" | "warn",
  context: string,
  message: string,
  meta?: unknown,
): void => {
  if (level === "error") {
    logger.error(`[TURN] :: [ERROR] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "success") {
    logger.info(`[TURN] :: [SUCCESS] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "warn") {
    logger.warn(`[TURN] :: [WARN] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "info") {
    logger.info(`[TURN] :: [INFO] :: [${context}] :: ${message} :: ${meta}`);
  }
};

/**
 * The shared secret must never reach a log line, a response body or an error
 * message, so it is reduced to a length before being reported anywhere.
 */
export const describeSecret = (secret: string): string =>
  secret.length === 0 ? "unset" : `${secret.length} characters`;
