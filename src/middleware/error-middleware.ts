import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";
import { ApiResponse } from "../utils/api-response.js";
import { logger } from "../utils/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json(
      new ApiResponse(
        404,
        null,
        `route not found: ${req.method} ${req.originalUrl}`,
      ),
    );
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const statusCode =
    err instanceof ApiError
      ? err.statusCode
      : Number.isInteger((err as { status?: number })?.status)
        ? (err as { status: number }).status
        : 500;

  // ApiError messages are deliberate (including 5xx such as 503 "relay is not
  // configured"); anything else on a 5xx is unexpected and never leaks.
  const message =
    err instanceof ApiError
      ? err.message
      : statusCode < 500 && typeof (err as Error)?.message === "string"
        ? (err as Error).message
        : "internal server error";

  if (statusCode >= 500) {
    logger.error(
      { err, method: req.method, path: req.originalUrl },
      "[HTTP] :: unhandled error",
    );
  }

  res.status(statusCode).json(new ApiResponse(statusCode, null, message));
};
