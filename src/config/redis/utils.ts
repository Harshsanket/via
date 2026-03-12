import { redisClient } from "./index.js";
import { logger } from "../../utils/logger.js";
import { Level } from "./types.js";

export const isValidString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

export const areValidStrings = (...values: unknown[]): boolean => {
  return values.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
};

export const logRedisError = (
  context: string,
  message: string,
  error?: unknown,
): void => {
  logger.error(`[REDIS] :: [ERROR] :: [${context}] :: ${message} :: ${error}`);
};

export const redisKeyExists = async (key: string): Promise<boolean> => {
  return (await redisClient.exists(key)) === 1;
};

export const getPeerInfo = async (
  key: string,
  context: string,
): Promise<string> => {
  if (!areValidStrings(key, context)) {
    logger.error(
      `[VALIDATION] :: [ERROR] :: [getPeerInfo] :: KEY OR CONTEXT INVALID TYPE :: ${key}`,
    );
    throw new Error("invalid type");
  }

  const value = await redisClient.get(key);
  if (value === null) {
    logger.error(`[REDIS] :: [${context}] :: KEY NOT FOUND :: ${key}`);
    throw new Error("key not found");
  }
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
  if (level === "error") {
    logger.error(`[REDIS] :: [ERROR] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "success") {
    logger.info(
      `[REDIS] :: [SUCCESS] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
};
