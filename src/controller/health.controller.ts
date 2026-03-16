import { Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiResponse } from "../utils/api-response.js";

export const healthCheck = asyncHandler((req: Request, res: Response): void => {
  res.status(200).json(
    new ApiResponse(
      200,
      {
        uptime: process.uptime(),
        timestamp: Date.now(),
      },
      "server is online",
    ),
  );
});
