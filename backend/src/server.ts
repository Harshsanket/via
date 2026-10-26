import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app.js";
import { env, isAllowedOrigin } from "./config/env.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "./config/socket/types.js";
import { connectRedis, redisClient } from "./config/redis/index.js";
import { RECOVERY_WINDOW_MS, initSocket } from "./config/socket/index.js";
import { logTurnConfiguration } from "./config/turn/index.js";
import { logger } from "./utils/logger.js";

// server config
const httpServer = createServer(app);

// socket io config
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  // CORS headers only stop a browser from *reading* polling responses; a
  // WebSocket upgrade ignores them. allowRequest refuses a foreign Origin on
  // every transport before a connection exists.
  allowRequest: (req, callback) => {
    callback(null, isAllowedOrigin(req.headers.origin, req.headers.host));
  },
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  },
  // Signaling payloads are small; the 1 MB default is far more than needed.
  maxHttpBufferSize: 100_000,
  serveClient: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  // A transport blip (a phone backgrounding Safari) recovers inside this
  // window as the same socket. `disconnect` still fires, so initSocket defers
  // the Redis cleanup for recoverable reasons and cancels it on recovery.
  connectionStateRecovery: {
    maxDisconnectionDuration: RECOVERY_WINDOW_MS,
    skipMiddlewares: true,
  },
});

initSocket(io);

let shuttingDown = false;

// Handle graceful shutdown
const shutdownServer = async (
  signal: string,
  exitCode: number = 0,
): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn(
    `[SERVER] :: [${signal}] received :: Shutting down gracefully...`,
  );

  const forceExit = setTimeout(() => {
    logger.error("[SERVER] :: shutdown timed out :: forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    // Closing Socket.IO also closes the underlying HTTP server, so connected
    // clients are terminated instead of hanging until the process is killed.
    await io.close();

    if (redisClient.isOpen) {
      logger.info("[REDIS] :: closing client connection");
      await redisClient.quit();
    }

    clearTimeout(forceExit);
    logger.info("[SERVER] :: Cleanup complete. Exiting...");
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, "[SERVER] :: Shutdown error");
    process.exit(1);
  }
};

const start = async (): Promise<void> => {
  // Connect dependencies first: the port must not accept traffic before Redis
  // is usable.
  await connectRedis();

  // Reported once, so a missing or malformed relay is visible in the logs
  // instead of surfacing as a client that cannot connect.
  logTurnConfiguration();

  await new Promise<void>((resolve) => {
    httpServer.listen(env.port, () => {
      logger.info(`[SERVER] :: connected to PORT :: ${env.port}`);
      resolve();
    });
  });
};

start().catch(async (err: unknown) => {
  logger.error({ err }, "[SERVER] :: failed to start");
  if (redisClient.isOpen) await redisClient.quit().catch(() => undefined);
  process.exit(1);
});

process.on("SIGINT", () => void shutdownServer("SIGINT"));
process.on("SIGTERM", () => void shutdownServer("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "[PROCESS] :: unhandled rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "[PROCESS] :: uncaught exception");
  void shutdownServer("uncaughtException", 1);
});
