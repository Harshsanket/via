import { env } from "../env.js";
import type { ViaSocket } from "./types.js";

/**
 * Per-socket event budgets. Each registered event gets its own token bucket:
 * `capacity` events in a burst, refilled at `refillPerSecond`. The values sit
 * well above what the app sends in normal use (one create per session, a few
 * dozen ICE candidates per negotiation) and far below a flood.
 */
interface BucketSpec {
  capacity: number;
  refillPerSecond: number;
}

const EVENT_LIMITS: Record<string, BucketSpec> = {
  "create-session": { capacity: 3, refillPerSecond: 0.1 },
  "join-session": { capacity: 5, refillPerSecond: 0.2 },
  offer: { capacity: 10, refillPerSecond: 1 },
  answer: { capacity: 10, refillPerSecond: 1 },
  "ice-candidate": { capacity: 100, refillPerSecond: 10 },
};

const DEFAULT_LIMIT: BucketSpec = { capacity: 20, refillPerSecond: 2 };

/** Refused events after which a socket is cut off instead of answered. */
export const MAX_VIOLATIONS = 200;

export const RATE_LIMIT_MESSAGE = "too many requests";
export const CONNECTION_LIMIT_MESSAGE = "too many connections";

export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly spec: BucketSpec) {
    this.tokens = spec.capacity;
  }

  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.spec.capacity,
      this.tokens + ((now - this.last) / 1000) * this.spec.refillPerSecond,
    );
    this.last = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const createEventLimiter = (event: string): TokenBucket =>
  new TokenBucket(EVENT_LIMITS[event] ?? DEFAULT_LIMIT);

const violations = new WeakMap<ViaSocket, number>();

/** Counts a refused event and returns the socket's running total. */
export const recordViolation = (socket: ViaSocket): number => {
  const count = (violations.get(socket) ?? 0) + 1;
  violations.set(socket, count);
  return count;
};

// ---------------------------------------------------------------------------
// Concurrent sockets per client IP
// ---------------------------------------------------------------------------

/** An IPv4 network, or a single IPv6 address (only ::1 is expected). */
type TrustedProxy =
  | { kind: "v4"; network: number; mask: number }
  | { kind: "v6"; address: string };

const parseIPv4 = (value: string): number | null => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
};

const stripMappedPrefix = (address: string): string =>
  address.startsWith("::ffff:") ? address.slice(7) : address;

/**
 * Parses "172.30.1.0/24, 10.0.0.5, ::1". Invalid entries are dropped, so a
 * typo trusts less, never more.
 */
export const parseTrustedProxies = (value: string): TrustedProxy[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry): TrustedProxy[] => {
      if (entry.includes(":")) return [{ kind: "v6", address: entry }];

      const [ip, bitsText] = entry.split("/");
      const network = parseIPv4(ip ?? "");
      const bits = bitsText === undefined ? 32 : Number(bitsText);
      if (
        network === null ||
        !Number.isInteger(bits) ||
        bits < 0 ||
        bits > 32
      ) {
        return [];
      }
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return [{ kind: "v4", network: (network & mask) >>> 0, mask }];
    });

export const isTrustedProxy = (
  address: string,
  trusted: TrustedProxy[],
): boolean => {
  const plain = stripMappedPrefix(address);
  const v4 = parseIPv4(plain);

  return trusted.some((proxy) =>
    proxy.kind === "v4"
      ? v4 !== null && (v4 & proxy.mask) >>> 0 === proxy.network
      : proxy.address === address,
  );
};

const trustedProxies = parseTrustedProxies(env.trustedProxies);

/**
 * The client's address. nginx sets X-Real-IP to the real client (behind
 * Caddy, via its realip module). The header is only trusted from the
 * addresses in TRUSTED_PROXIES (default: loopback, for the single-container
 * image), so nobody else can pick their own bucket.
 */
export const getClientIp = (socket: ViaSocket): string => {
  const address = socket.handshake.address;
  const forwarded = socket.handshake.headers["x-real-ip"];

  if (
    isTrustedProxy(address, trustedProxies) &&
    typeof forwarded === "string" &&
    forwarded.length > 0 &&
    forwarded.length <= 64
  ) {
    return forwarded;
  }
  return address;
};

const socketsPerIp = new Map<string, number>();

export const isOverConnectionCap = (ip: string): boolean =>
  (socketsPerIp.get(ip) ?? 0) >= env.maxSocketsPerIp;

export const trackConnection = (ip: string): void => {
  socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);
};

export const releaseConnection = (ip: string): void => {
  const remaining = (socketsPerIp.get(ip) ?? 1) - 1;
  if (remaining <= 0) socketsPerIp.delete(ip);
  else socketsPerIp.set(ip, remaining);
};
