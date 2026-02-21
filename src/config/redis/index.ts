import { createClient } from "redis";
import { logger } from "../../utils/logger.js";

export const redisClient = createClient({ url: process.env.REDIS_URL });

export const connectRedis = async (): Promise<void> => {
  try {
    logger.info(`[REDIS] :: Connecting to client...`);

    // Set up event listeners
    redisClient.on("error", (err) => {
      logger.error(`[REDIS] :: Client error :: ${err}`);
    });

    redisClient.on("ready", () => {
      logger.info(`[REDIS] :: Client ready`);
    });

    // Connect client
    await redisClient.connect();

    // Verify connection
    const result = await redisClient.ping();
    if (!result)
      logger.warn(`[REDIS] :: Something went wrong while ping to client`);

    logger.info(
      `[REDIS] :: Client connection successful :: ${process.env.REDIS_URL}`,
    );
  } catch (err) {
    logger.error(`[REDIS] :: Client connection failed :: ${err}`);
    throw err;
  }
};
