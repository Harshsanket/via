import app from "./app.js";
import dotenv from "dotenv";
import { createServer } from "http";
import { redisClient, connectRedis } from "./config/redis/index.js";
import { prisma, connectPrisma } from "./database/index.js";
import { Server } from "socket.io";
import { initSocket } from "./config/socket/index.js";
import { logger } from "./utils/logger.js";

// env config
dotenv.config({ path: "" });

// server config
const httpServer = createServer(app);

// socket io config
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(","),
    credentials: true,
  },
});

initSocket(io);

httpServer.listen(process.env.PORT, async () => {
  // server log
  logger.info(`[SERVER] :: connected to PORT :: ${process.env.PORT}`);

  // connect redis
  connectRedis();

  // connect postgres db
  connectPrisma().catch(async (err) => {
    logger.warn(`[PRISMA] :: error in prisma main fn :: ${err}`);
    await prisma.$disconnect();
    process.exit(1);
  });
});

// Handle graceful shutdown

const shutdownServer = async (signal: string): Promise<void> => {
  // close server
  const closeServer = () =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Server close timeout")),
        10000,
      );
      httpServer.close((err) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        resolve();
      });
    });

  try {
    // log input
    logger.warn(
      `[SERVER] :: [${signal}] received :: Shutting down gracefully...`,
    );

    // close server
    closeServer();

    // disconnect db
    logger.info(`[REDIS] :: [${signal}] received :: Closing client connection`);
    await redisClient.quit();

    logger.info(`[PRISMA] :: [${signal}] received :: Disconnecting db connection`);
    await prisma.$disconnect();

    // finall call
    logger.info(`[SERVER] :: Cleanup complete. Exiting...`);
    logger.warn(`SERVER HAS BEEN SHUTDOWN`);
    process.exit(0);
  } catch (err) {
    logger.error(`[SERVER] :: Shutdown error :: ${err}`);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdownServer("SIGINT"));
process.on("SIGTERM", () => shutdownServer("SIGTERM"));
