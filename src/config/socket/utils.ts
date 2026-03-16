import { logger } from "../../utils/logger.js";
import { Level } from "./types.js";

const MAX_FILE_SIZE: number = 50 * 1024 * 1024 * 1024;

export const logSocket = (
  level: Level,
  context: string,
  message: string,
  meta?: unknown,
): void => {
  if (level === "error") {
    logger.error(
      `[SOCKET] :: [ERROR] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
  if (level === "success") {
    logger.info(
      `[SOCKET] :: [SUCCESS] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
  if (level === "warn") {
    logger.warn(`[SOCKET] :: [WARN] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "info") {
    logger.info(
      `[SOCKET] :: [REQUEST RECEIVED] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
};

export const isCallback = (cb: unknown): cb is Function => {
  return typeof cb === "function";
};

export const isValidFileMetadata = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== "object") return false;

  const m = metadata as {
    fileName?: unknown;
    mimeType?: unknown;
    fileSize?: unknown;
  };

  if (m.fileName == null || m.mimeType == null || m.fileSize == null) {
    return false;
  }

  if (
    typeof m.fileName !== "string" ||
    typeof m.mimeType !== "string" ||
    typeof m.fileSize !== "number"
  ) {
    return false;
  }

  if (m.fileName.trim().length === 0) return false;

  if (m.fileSize <= 0 || m.fileSize > MAX_FILE_SIZE) {
    return false;
  }

  return true;
};
