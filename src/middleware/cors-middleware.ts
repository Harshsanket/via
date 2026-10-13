import cors from "cors";
import type { CorsOptions } from "cors";
import { isAllowedOrigin } from "../config/env.js";

/**
 * Built lazily, after the environment has been validated, so the allowlist is
 * never read before dotenv has run.
 *
 * A rejected origin resolves with `false` (no CORS headers) rather than an
 * error, so a foreign origin is blocked by the browser instead of turning into
 * a 500 for a request that is otherwise harmless.
 */
export const corsOptions = (): CorsOptions => ({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
});

export { cors };
