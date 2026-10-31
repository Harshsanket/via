import type { Request, Response } from "express";
import {
  getPublicSettings,
  issueAdminToken,
  updateAdminCredentials,
  updateSettings,
  verifyAdminCredentials,
} from "../config/settings.js";
import { ApiError } from "../utils/api-error.js";
import { ApiResponse } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_LIMIT = 15;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, max: number, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ApiError(400, `${field} invalid`);
  }
  return value;
};

const takeLoginAttempt = (ip: string): boolean => {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || now >= current.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= LOGIN_LIMIT) return false;
  current.count += 1;
  return true;
};

export const adminLogin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!takeLoginAttempt(req.ip ?? "unknown")) {
      throw new ApiError(429, "too many login attempts, try again in a minute");
    }

    if (!isRecord(req.body)) {
      throw new ApiError(400, "login payload invalid");
    }
    const username = boundedString(req.body.username, 64, "username");
    const password = boundedString(req.body.password, 128, "password");

    if (!verifyAdminCredentials(username, password)) {
      throw new ApiError(401, "invalid username or password");
    }

    const { token, expiresAt } = issueAdminToken();
    res.status(200).json(
      new ApiResponse(
        200,
        {
          token,
          expiresAt,
          mustChangePassword: getPublicSettings().admin.mustChangePassword,
        },
        "signed in",
      ),
    );
  },
);

export const getAdminSettings = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    res
      .status(200)
      .json(new ApiResponse(200, getPublicSettings(), "settings loaded"));
  },
);

export const saveAdminSettings = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (getPublicSettings().admin.mustChangePassword) {
      throw new ApiError(
        403,
        "change the default admin password before editing settings",
      );
    }

    const settings = updateSettings(req.body);
    res.status(200).json(new ApiResponse(200, settings, "settings saved"));
  },
);

export const changeAdminCredentials = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!isRecord(req.body)) {
      throw new ApiError(400, "credentials payload invalid");
    }

    const currentPassword = boundedString(
      req.body.currentPassword,
      128,
      "current password",
    );
    const username = boundedString(req.body.username, 32, "username");
    const newPassword = boundedString(
      req.body.newPassword,
      128,
      "new password",
    );

    const { token, expiresAt } = updateAdminCredentials({
      currentPassword,
      username,
      newPassword,
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { token, expiresAt, mustChangePassword: false },
          "credentials updated",
        ),
      );
  },
);
