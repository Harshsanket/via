import cors from "cors";
import type { CorsOptionsDelegate } from "cors";
import type { Request } from "express";
import { isAllowedOrigin } from "../config/env.js";

/**
 * Built lazily, after the environment has been validated, so the allowlist is
 * never read before dotenv has run.
 *
 * A rejected origin resolves with `false` (no CORS headers) rather than an
 * error, so a foreign origin is blocked by the browser instead of turning into
 * a 500 for a request that is otherwise harmless.
 *
 * No credentials: the API uses no cookies or auth headers, so allowing them
 * would only widen what a permitted origin could do.
 */
export const corsOptions =
  (): CorsOptionsDelegate<Request> => (req, callback) => {
    callback(null, {
      origin: isAllowedOrigin(req.header("origin"), req.header("host")),
      methods: "GET,HEAD",
      preflightContinue: false,
      optionsSuccessStatus: 204,
      allowedHeaders: ["Content-Type"],
    });
  };

export { cors };
