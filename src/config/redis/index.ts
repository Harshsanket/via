import { createClient } from "redis";
<<<<<<< HEAD
import { logger } from "../../utils/logger.js";

export const redisClient = createClient({ url: process.env.REDIS_URL });

// server
export const connectRedis = async (): Promise<void> => {
  try {
    logger.info(`[REDIS] :: Connecting to client...`);

    // Set up event listeners
    redisClient.on("error", (err) => {
      logger.error(`[REDIS] :: Client error :: ${err}`);
    });

    redisClient.on("ready", () => {
      logger.info(`[REDIS] :: [CLIENT READY TO CONNECT]`);
=======
import { logRedis } from "./utils.js";

export const redisClient = createClient({ url: process.env.REDIS_URL });
// server
export const connectRedis = async (): Promise<void> => {
  try {
    logRedis("success", "connectRedis", "CONNECTING TO CLIENT ...");

    // Set up event listeners
    redisClient.on("error", (err) => {
      logRedis("error", "connectRedis", "CLIENT CONNECTION ERROR", err);
    });

    redisClient.on("ready", () => {
      logRedis("success", "connectRedis", "CLIENT READY TO CONNECT");
>>>>>>> main
    });

    // Connect client
    await redisClient.connect();

    // Verify connection
    const result = await redisClient.ping();
<<<<<<< HEAD
    if (!result)
      logger.warn(`[REDIS] :: Something went wrong while ping to client`);

    logger.info(
      `[REDIS] :: [CLIENT CONNECTION SUCCESSFUL] :: CONNECTED TO :: ${process.env.REDIS_URL}`,
    );
  } catch (err) {
    logger.error(
      `[REDIS] :: [ERROR] :: CLIENT CONNECTION FAILED WITH ERROR :: ${err}`,
    );
=======
    if (result) {
      logRedis(
        "success",
        "connectRedis",
        "CLIENT CONNECTION SUCCESSFUL",
        process.env.REDIS_URL,
      );
    } else {
      logRedis("error", "connectRedis: [result]", "UNABLE TO PING CLIENT");
    }
  } catch (err) {
    logRedis("error", "connectRedis", "CLIENT CONNECTION FAILED", err);
>>>>>>> main
    throw err;
  }
};
