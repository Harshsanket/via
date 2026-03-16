import { logger } from "../../utils/logger.js";
import { Level } from "./types.js";

export const logWebRTC = (
  level: Level,
  context: string,
  message: string,
  meta?: unknown,
): void => {
  if (level === "error") {
    logger.error(
      `[WEBRTC] :: [ERROR] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
  if (level === "success") {
    logger.info(
      `[WEBRTC] :: [SUCCESS] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
  if (level === "warn") {
    logger.warn(`[WEBRTC] :: [WARN] :: [${context}] :: ${message} :: ${meta}`);
  }
  if (level === "info") {
    logger.info(
      `[WEBRTC] :: [REQUEST RECEIVED] :: [${context}] :: ${message} :: ${meta}`,
    );
  }
};
