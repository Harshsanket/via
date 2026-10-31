import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../config/env.js";
import { verifyAdminToken } from "../config/settings.js";
import { ApiError } from "../utils/api-error.js";

/** Only the loopback-only nginx listener may reach the admin API in production. */
export const requireAdminListener = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (isProduction() && req.header("x-via-admin") !== "1") {
    next(new ApiError(404, "route not found"));
    return;
  }
  next();
};

/** Requires a valid short-lived admin bearer token. */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const payload = token ? verifyAdminToken(token) : null;

  if (!payload) {
    next(new ApiError(401, "admin authentication required"));
    return;
  }

  res.locals.admin = payload;
  next();
};
