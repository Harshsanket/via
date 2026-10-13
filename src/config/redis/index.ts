import { createClient } from "redis";
import { env, redactUrl } from "../env.js";
import { logRedis } from "./utils.js";

export const redisClient = createClient({ url: env.redisUrl });

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
    });

    // Connect client
    await redisClient.connect();

    // Verify connection
    const result = await redisClient.ping();
    if (result) {
      logRedis(
        "success",
        "connectRedis",
        "CLIENT CONNECTION SUCCESSFUL",
        redactUrl(env.redisUrl),
      );
    } else {
      logRedis("error", "connectRedis: [result]", "UNABLE TO PING CLIENT");
    }
  } catch (err) {
    logRedis("error", "connectRedis", "CLIENT CONNECTION FAILED", err);
    throw err;
  }
};
