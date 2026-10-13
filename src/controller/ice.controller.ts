import { Request, Response } from "express";
import { isSessionExist } from "../config/redis/service.js";
import { isTurnConfigured, mintIceServers } from "../config/turn/index.js";
import { ApiError } from "../utils/api-error.js";
import { ApiResponse } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";
import { areValidStrings } from "../utils/validators.js";

/**
 * Hands a peer the ICE configuration it needs to reach the other side,
 * including an ephemeral TURN credential.
 *
 * A live session is required: this endpoint vends relay access, so it must not
 * be an open credential service. The session id is the same secret the socket
 * flow already relies on, which is the best available check until accounts
 * exist.
 */
export const getIceServers = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const sessionId =
      typeof req.query.sessionId === "string" ? req.query.sessionId : "";

    if (!areValidStrings(sessionId)) {
      throw new ApiError(400, "session id invalid");
    }

    if (!(await isSessionExist(sessionId))) {
      throw new ApiError(404, "session expired or invalid");
    }

    // Reported before minting so the reason is explicit rather than an
    // internal error from the credentials module.
    if (!isTurnConfigured()) {
      throw new ApiError(503, "relay is not configured");
    }

    const minted = mintIceServers();

    // Credentials are per-request; a shared cache must never replay them.
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json(new ApiResponse(200, minted, "ice servers issued"));
  },
);
