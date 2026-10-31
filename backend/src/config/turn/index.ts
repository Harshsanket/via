import { createHmac, randomUUID } from "node:crypto";
import { env } from "../env.js";
import { getSettings } from "../settings.js";
import { ApiError } from "../../utils/api-error.js";
import type {
  IceServer,
  MintedIceServers,
  TurnCredentialAlgorithm,
} from "./types.js";
import { describeSecret, logTurn } from "./utils.js";

/**
 * TURN REST API (draft-uberti-behave-turn-rest-00): the username carries the
 * expiry and an opaque id, and the password is the shared secret's HMAC of that
 * username. coturn verifies it with `--use-auth-secret`, so the secret itself
 * never leaves the server and no static password ships in the browser bundle.
 *
 * `password = base64(hmac(secret, "<expiry-unix-seconds>:<id>"))`
 */
export const signTurnCredential = (
  username: string,
  secret: string,
  algorithm: TurnCredentialAlgorithm,
): string => createHmac(algorithm, secret).update(username).digest("base64");

const isTurnUrl = (url: string): boolean =>
  /^turns?:/i.test(url) && url.length > "turn:".length;

const isStunUrl = (url: string): boolean =>
  /^stuns?:/i.test(url) && url.length > "stun:".length;

/**
 * A TURN server answers STUN on the same port, so a `stun:` entry that points
 * at a configured relay is redundant and shows up as a second "coturn" line in
 * the browser's ICE logs. Reduce both schemes to the same key so one can be
 * dropped. TLS and plaintext endpoints are kept apart.
 */
const relayEndpoint = (url: string): string | null => {
  const match = /^(turns?|stuns?):(.+)$/i.exec(url.trim());
  if (!match) return null;

  const scheme = match[1].toLowerCase();
  const secure = scheme === "turns" || scheme === "stuns";
  const authority = match[2].split("?")[0].split("/")[0].trim();
  if (!authority) return null;

  const defaultPort = secure ? "5349" : "3478";
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority);
  if (ipv6) {
    return `${secure ? "tls" : "plain"}|[${ipv6[1].toLowerCase()}]:${ipv6[2] ?? defaultPort}`;
  }

  const hostPort = /^([^:]+)(?::(\d+))?$/.exec(authority);
  if (!hostPort) return null;

  return `${secure ? "tls" : "plain"}|${hostPort[1].toLowerCase()}:${hostPort[2] ?? defaultPort}`;
};

/** Drops STUN entries that a TURN URL already covers on the same endpoint. */
const withoutRelayDuplicates = (
  stunUrls: string[],
  turnUrls: string[],
): string[] => {
  const relayed = new Set(
    turnUrls
      .map(relayEndpoint)
      .filter((endpoint): endpoint is string => endpoint !== null),
  );

  return stunUrls.filter((url) => {
    const endpoint = relayEndpoint(url);
    return endpoint === null || !relayed.has(endpoint);
  });
};

const networkSettings = () => {
  const { stunUrls, turnUrls, turnCredentialTtlSeconds } =
    getSettings().network;
  return {
    turnUrls: turnUrls.filter(isTurnUrl),
    stunUrls: stunUrls.filter(isStunUrl),
    rejectedTurnUrls: turnUrls.filter((url) => !isTurnUrl(url)),
    rejectedStunUrls: stunUrls.filter((url) => !isStunUrl(url)),
    ttlSeconds: turnCredentialTtlSeconds,
  };
};

/**
 * A relay needs both halves. A URL without a secret (or the reverse) is
 * treated as no relay at all, so a half-finished configuration cannot hand out
 * credentials that no relay would ever accept.
 */
export const isTurnConfigured = (): boolean =>
  networkSettings().turnUrls.length > 0 && env.turnSecret.length > 0;

/**
 * Reports the relay configuration once at boot. A missing relay is a warning
 * rather than a startup failure, because the signaling server is still useful
 * on a LAN without one, but it must not pass unnoticed either.
 */
export const logTurnConfiguration = (): void => {
  const { turnUrls, rejectedTurnUrls, rejectedStunUrls, ttlSeconds } =
    networkSettings();

  if (rejectedTurnUrls.length > 0) {
    logTurn(
      "error",
      "logTurnConfiguration",
      "IGNORING INVALID TURN URLS :: expected turn: or turns: URIs",
      rejectedTurnUrls,
    );
  }

  if (rejectedStunUrls.length > 0) {
    logTurn(
      "error",
      "logTurnConfiguration",
      "IGNORING INVALID STUN URLS :: expected stun: or stuns: URIs",
      rejectedStunUrls,
    );
  }

  if (!isTurnConfigured()) {
    logTurn(
      "warn",
      "logTurnConfiguration",
      "NO RELAY CONFIGURED :: transfers will only work between peers that can reach each other directly",
      {
        turnUrls: turnUrls.length,
        secret: describeSecret(env.turnSecret),
      },
    );
    return;
  }

  logTurn("success", "logTurnConfiguration", "RELAY CONFIGURED", {
    turnUrls,
    ttlSeconds,
    algorithm: env.turnCredentialAlgorithm,
    secret: describeSecret(env.turnSecret),
  });
};

/**
 * Mints one set of credentials. Every call gets its own suffix so credentials
 * are distinguishable in the relay's logs, and so a leaked credential can be
 * traced back to a single client.
 */
export const mintIceServers = ({
  suffix = randomUUID(),
  now = Date.now(),
}: { suffix?: string; now?: number } = {}): MintedIceServers => {
  const { turnUrls, stunUrls, ttlSeconds } = networkSettings();

  if (!isTurnConfigured()) {
    logTurn("error", "mintIceServers", "REFUSED :: no relay is configured", {
      turnUrls: turnUrls.length,
      secret: describeSecret(env.turnSecret),
    });
    throw new ApiError(503, "relay is not configured");
  }

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${suffix}`;
  const credential = signTurnCredential(
    username,
    env.turnSecret,
    env.turnCredentialAlgorithm,
  );

  // STUN first: a direct path is the outcome to aim for, and the relay is the
  // fallback. Both are offered so ICE can gather candidates for each, except
  // when the configured STUN server is the relay itself.
  const iceServers: IceServer[] = [];
  const distinctStunUrls = withoutRelayDuplicates(stunUrls, turnUrls);

  if (distinctStunUrls.length > 0) {
    iceServers.push({ urls: distinctStunUrls });
  }

  iceServers.push({
    urls: turnUrls,
    username,
    credential,
  });

  return {
    iceServers,
    ttlSeconds,
    expiresAt,
    algorithm: env.turnCredentialAlgorithm,
  };
};
