import "dotenv/config";
import { logger } from "../utils/logger.js";

const requiredVariables = ["REDIS_URL"] as const;

const missingVariables = requiredVariables.filter(
  (key) => !process.env[key]?.trim(),
);

if (missingVariables.length > 0) {
  throw new Error(
    `[ENV] :: missing required environment variables :: ${missingVariables.join(", ")}`,
  );
}

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const parseNonNegativeInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
};

const parseList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const clientOrigins: string[] = parseList(process.env.CLIENT_ORIGIN);

/**
 * Public STUN is enough to discover a server-reflexive candidate, which is all
 * two peers behind ordinary home NATs need. It cannot relay, so it does not
 * replace TURN for symmetric NAT, CGNAT or restrictive firewalls.
 */
const DEFAULT_STUN_URLS = "stun:stun.l.google.com:19302";

const turnSecret = process.env.TURN_SECRET?.trim() ?? "";
const turnUrls = parseList(process.env.TURN_URLS);

/**
 * The algorithm that signs the ephemeral TURN password. coturn's
 * `--use-auth-secret` uses HMAC-SHA1, which is also what the TURN REST API
 * draft names; SHA-256 is offered for relays that expect it.
 */
const parseCredentialAlgorithm = (
  value: string | undefined,
): "sha1" | "sha256" =>
  value?.trim().toLowerCase() === "sha256" ? "sha256" : "sha1";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePositiveInt(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL as string,
  clientOrigins,
  logLevel: process.env.LOG_LEVEL ?? "info",
  /**
   * Concurrent sessions a single peer may own. The session flow allows one
   * active session per peer; the counter makes that rule race proof.
   */
  maxActiveSessionsPerPeer: parsePositiveInt(
    process.env.MAX_ACTIVE_SESSIONS_PER_PEER,
    1,
  ),
  /**
   * Concurrent sockets one client IP may hold. A household sends from a few
   * tabs at most; this stops one device from opening thousands.
   */
  maxSocketsPerIp: parsePositiveInt(process.env.MAX_SOCKETS_PER_IP, 20),
  /**
   * Addresses allowed to report the client IP in X-Real-IP: comma-separated
   * IPv4 CIDRs or single IPs, plus ::1. Loopback by default (nginx in the
   * same container); the split compose stack sets nginx's network.
   */
  trustedProxies: process.env.TRUSTED_PROXIES?.trim() || "127.0.0.1/32,::1",
  /**
   * Absolute age a session may reach, however often it is extended. Without a
   * cap, activity could keep a session (and its Redis keys) alive forever.
   */
  sessionMaxLifetimeSeconds: parsePositiveInt(
    process.env.SESSION_MAX_LIFETIME_SECONDS,
    24 * 60 * 60,
  ),
  /**
   * How long before expiry the server pushes `session:expiring`, so clients do
   * not have to poll `get-ttl`. 0 disables the warning push.
   */
  sessionExpiryWarningSeconds: parseNonNegativeInt(
    process.env.SESSION_EXPIRY_WARNING_SECONDS,
    30,
  ),
  /**
   * STUN servers handed to clients. Always safe to publish, never secret.
   */
  stunUrls: parseList(process.env.STUN_URLS ?? DEFAULT_STUN_URLS),
  /**
   * The relay(s) clients may use, e.g. `turn:turn.example.com:3478?transport=udp`.
   * Empty means no relay is configured, and `GET /api/v1/ice-servers` refuses
   * rather than pretending the LAN-only situation is fine.
   */
  turnUrls,
  /**
   * Shared with the relay (`--static-auth-secret` in coturn). Never sent to a
   * client, and never logged: the whole point of the credential endpoint is
   * that this value stays on the server.
   */
  turnSecret,
  /**
   * Lifetime of a minted credential. The TURN REST API draft recommends one
   * day, and expiry only blocks *new* allocations: an allocation already in
   * use keeps working, so a transfer cannot be cut off by credential expiry.
   */
  turnCredentialTtlSeconds: parsePositiveInt(
    process.env.TURN_TTL_SECONDS,
    24 * 60 * 60,
  ),
  turnCredentialAlgorithm: parseCredentialAlgorithm(
    process.env.TURN_CREDENTIAL_ALGORITHM,
  ),
} as const;

export const isProduction = (): boolean => env.nodeEnv === "production";

/** True when `origin` names the same host the request was sent to. */
const isSameHost = (origin: string, host: string | undefined): boolean => {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

/**
 * Allowlist check shared by the HTTP CORS middleware and Socket.IO.
 *
 * Requests without an Origin header (curl, server to server, same-origin
 * GETs) are allowed. With an allowlist, only listed origins pass. Without
 * one, production accepts only the page's own origin (the request's Host),
 * so a forgotten CLIENT_ORIGIN fails closed; development still accepts any
 * origin so the Vite dev server on another port works.
 */
export const isAllowedOrigin = (
  origin: string | undefined,
  host?: string,
): boolean => {
  if (!origin) return true;
  if (env.clientOrigins.length > 0) return env.clientOrigins.includes(origin);
  if (isProduction()) return isSameHost(origin, host);
  return true;
};

/** Strip credentials so connection strings can be logged safely. */
export const redactUrl = (url: string | undefined): string => {
  if (!url) return "unset";
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable url>";
  }
};
