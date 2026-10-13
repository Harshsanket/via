import {
  KEY_PREFIXES,
  NO_PEER,
  SESSION_FIELDS,
  peerStorageKey,
  sessionStorageKey,
} from "./constants.js";
import { redisClient } from "./index.js";

const F = SESSION_FIELDS;
const P = KEY_PREFIXES;

/**
 * Atomic join.
 *
 * The limit check, the membership write and the TTL grant happen in one server
 * side script, so two simultaneous joins can no longer both read "not full" and
 * both succeed (the previous multi() pipelines could).
 *
 * KEYS[1] session hash, KEYS[2] joining peer key
 * ARGV[1] peerId, ARGV[2] sessionId, ARGV[3] now (ms), ARGV[4] desired TTL
 * seconds, ARGV[5] max lifetime seconds, ARGV[6] "no peer" sentinel
 *
 * Returns {status, connectedPeers, ttlSeconds}.
 *
 * Note: the creator's peer key is derived at runtime from the key prefix, which
 * is why this reads a plain single-node Redis rather than a cluster.
 */
export const JOIN_SESSION_SCRIPT = `
local sessionKey = KEYS[1]
local peerKey = KEYS[2]
local peerId = ARGV[1]
local sessionId = ARGV[2]
local now = tonumber(ARGV[3])
local desiredTtl = tonumber(ARGV[4])
local maxLifetime = tonumber(ARGV[5])
local noPeer = ARGV[6]

local maxAllowedField = '${F.maxAllowedPeers}'
local connectedPeerField = '${F.connectedPeer}'
local connectedPeersField = '${F.connectedPeers}'
local createdByField = '${F.createdBy}'
local createdAtField = '${F.createdAt}'
local lastActivityField = '${F.lastActivity}'
local peerPrefix = '${P.peer}'

if redis.call('EXISTS', sessionKey) == 0 then
  return {'not-found'}
end

local maxAllowed = tonumber(redis.call('HGET', sessionKey, maxAllowedField))
if maxAllowed == nil or maxAllowed <= 0 then
  return {'misconfigured'}
end

-- Grant the smaller of the requested TTL and the remaining lifetime. A session
-- older than the cap is refused instead of being silently extended.
local ttl = desiredTtl
local createdAt = tonumber(redis.call('HGET', sessionKey, createdAtField))
if createdAt ~= nil and maxLifetime > 0 then
  local remaining = math.floor((createdAt + maxLifetime * 1000 - now) / 1000)
  if remaining < ttl then
    ttl = remaining
  end
end

if ttl <= 0 then
  redis.call('DEL', sessionKey)
  return {'expired'}
end

local connectedPeer = redis.call('HGET', sessionKey, connectedPeerField)
local connectedPeers = tonumber(redis.call('HGET', sessionKey, connectedPeersField)) or 0

-- Rejoining as the recorded member is idempotent: it must not consume a slot.
if connectedPeer ~= peerId then
  if connectedPeers >= maxAllowed then
    return {'full'}
  end
  connectedPeers = redis.call('HINCRBY', sessionKey, connectedPeersField, 1)
end

redis.call('HSET', sessionKey, connectedPeerField, peerId)
redis.call('HSET', sessionKey, lastActivityField, tostring(now))
redis.call('EXPIRE', sessionKey, ttl)
redis.call('SET', peerKey, sessionId, 'EX', ttl)

local createdBy = redis.call('HGET', sessionKey, createdByField)
if createdBy ~= nil and createdBy ~= noPeer then
  redis.call('EXPIRE', peerPrefix .. createdBy, ttl)
end

return {'ok', tostring(connectedPeers), tostring(ttl)}
`;

/**
 * Atomic leave.
 *
 * The membership decrement only happens for the peer the session actually
 * records, which makes this idempotent: the `disconnecting` and `disconnect`
 * handlers can both run it without double counting.
 *
 * KEYS[1] session hash, KEYS[2] leaving peer key
 * ARGV[1] peerId, ARGV[2] sessionId, ARGV[3] now (ms), ARGV[4] "no peer" sentinel
 *
 * Returns {status, connectedPeers, memberId}; status is one of
 * deleted | left | no-session.
 */
export const LEAVE_SESSION_SCRIPT = `
local sessionKey = KEYS[1]
local peerKey = KEYS[2]
local peerId = ARGV[1]
local sessionId = ARGV[2]
local now = tonumber(ARGV[3])
local noPeer = ARGV[4]

local createdByField = '${F.createdBy}'
local connectedPeerField = '${F.connectedPeer}'
local connectedPeersField = '${F.connectedPeers}'
local lastActivityField = '${F.lastActivity}'
local peerPrefix = '${P.peer}'

if redis.call('EXISTS', sessionKey) == 0 then
  redis.call('DEL', peerKey)
  return {'no-session', '0', ''}
end

local createdBy = redis.call('HGET', sessionKey, createdByField)
local connectedPeer = redis.call('HGET', sessionKey, connectedPeerField)

if createdBy == peerId then
  -- The creator owns the session: it and every member mapping go with them.
  redis.call('DEL', sessionKey)
  redis.call('DEL', peerKey)
  if connectedPeer ~= nil and connectedPeer ~= noPeer then
    local memberKey = peerPrefix .. connectedPeer
    if redis.call('GET', memberKey) == sessionId then
      redis.call('DEL', memberKey)
    end
    return {'deleted', '0', connectedPeer}
  end
  return {'deleted', '0', ''}
end

local peers = redis.call('HGET', sessionKey, connectedPeersField)
if connectedPeer == peerId then
  local remaining = redis.call('HINCRBY', sessionKey, connectedPeersField, -1)
  if remaining < 0 then
    redis.call('HSET', sessionKey, connectedPeersField, '0')
    remaining = 0
  end
  redis.call('HSET', sessionKey, connectedPeerField, noPeer)
  peers = tostring(remaining)
end

redis.call('HSET', sessionKey, lastActivityField, tostring(now))
redis.call('DEL', peerKey)

return {'left', peers or '0', ''}
`;

export type JoinSessionResult =
  | { status: "ok"; connectedPeers: number; ttlSeconds: number }
  | { status: "not-found" }
  | { status: "misconfigured" }
  | { status: "full" }
  | { status: "expired" };

export interface LeaveSessionResult {
  status: "deleted" | "left" | "no-session";
  connectedPeers: number;
  memberId: string;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const runJoinSessionScript = async (params: {
  sessionId: string;
  peerId: string;
  desiredTtlSeconds: number;
  maxLifetimeSeconds: number;
}): Promise<JoinSessionResult> => {
  const reply = (await redisClient.eval(JOIN_SESSION_SCRIPT, {
    keys: [sessionStorageKey(params.sessionId), peerStorageKey(params.peerId)],
    arguments: [
      params.peerId,
      params.sessionId,
      Date.now().toString(),
      params.desiredTtlSeconds.toString(),
      params.maxLifetimeSeconds.toString(),
      NO_PEER,
    ],
  })) as unknown[] | null;

  const status = reply?.[0] === undefined ? "not-found" : String(reply[0]);

  switch (status) {
    case "ok":
      return {
        status: "ok",
        connectedPeers: toNumber(reply?.[1]),
        ttlSeconds: toNumber(reply?.[2]),
      };
    case "full":
      return { status: "full" };
    case "misconfigured":
      return { status: "misconfigured" };
    case "expired":
      return { status: "expired" };
    default:
      return { status: "not-found" };
  }
};

export const runLeaveSessionScript = async (params: {
  sessionId: string;
  peerId: string;
}): Promise<LeaveSessionResult> => {
  const reply = (await redisClient.eval(LEAVE_SESSION_SCRIPT, {
    keys: [sessionStorageKey(params.sessionId), peerStorageKey(params.peerId)],
    arguments: [
      params.peerId,
      params.sessionId,
      Date.now().toString(),
      NO_PEER,
    ],
  })) as unknown[] | null;

  const status = String(reply?.[0] ?? "no-session");

  return {
    status:
      status === "deleted" || status === "left"
        ? (status as LeaveSessionResult["status"])
        : "no-session",
    connectedPeers: toNumber(reply?.[1]),
    memberId: reply?.[2] === undefined ? "" : String(reply[2]),
  };
};
