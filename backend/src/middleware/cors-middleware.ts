import cors from "cors";
import type { CorsOptionsDelegate } from "cors";
import type { Request } from "express";
import { isAllowedOrigin, isProduction } from "../config/env.js";

/**
 * Built lazily, after the environment has been validated, so the allowlist is
 * never read before dotenv has run.
 *
 * A rejected origin resolves with `false` (no CORS headers) rather than an
 * error, so a foreign origin is blocked by the browser instead of turning into
 * a 500 for a request that is otherwise harmless.
 *
 * No credentials: the admin API uses a bearer token in a header, never a
 * cookie, so CORS credentials stay disabled.
 */
export const corsOptions =
  (): CorsOptionsDelegate<Request> => (req, callback) => {
    const adminRequest = req.path.startsWith("/api/v1/admin");
    callback(null, {
      // The admin page is same-origin on its loopback port. It never needs
      // cross-origin access, so a different origin gets no CORS headers.
      origin:
        isProduction() && adminRequest
          ? false
          : isAllowedOrigin(req.header("origin"), req.header("host")),
      methods: "GET,HEAD,POST,PUT",
      preflightContinue: false,
      optionsSuccessStatus: 204,
      allowedHeaders: ["Content-Type", "Authorization"],
    });
  };

export { cors };
