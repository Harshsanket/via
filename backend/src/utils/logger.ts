// Loaded here so every entry point reads the environment before the logger is
// constructed, no matter which module imports it first. Tests inject their
// configuration explicitly, so a developer's backend/.env must not leak in.
import dotenv from "dotenv";
import pino from "pino";

if (process.env.NODE_ENV !== "test") dotenv.config();

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }
    : undefined,
});
