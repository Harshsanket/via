import { Request, Response } from "express";
import { redisClient } from "../config/redis/index.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiResponse } from "../utils/api-response.js";

export const healthCheck = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Redis is the only hard dependency: every session lives there, so a
    // degraded Redis means the server cannot do its job at all.
    let redis = false;
    try {
      redis = redisClient.isOpen && (await redisClient.ping()) === "PONG";
    } catch {
      redis = false;
    }

    const statusCode = redis ? 200 : 503;

    res.status(statusCode).json(
      new ApiResponse(
        statusCode,
        {
          uptime: process.uptime(),
          timestamp: Date.now(),
          checks: { redis },
        },
        redis ? "server is online" : "server is degraded",
      ),
    );
  },
);
