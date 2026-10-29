import {
  KEY_PREFIXES,
  NO_FILE_SELECTED,
  NO_PEER,
  NO_SESSION,
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
 * seconds, ARGV[5] max lifetime seconds, ARGV[6] "no peer" sentinel,
 * ARGV[7] "no session" sentinel, ARGV[8] replaceable member id (empty when
 * none), ARGV[9] receiver token (empty when the client did not send one)
 *
 * A member whose socket is gone (a refreshed or closed tab) no longer holds
 * the slot, and a reloaded page that presents the same receiver token may take
 * over even while the old socket is still connected, as long as the transfer
 * has not started. A third peer's token does not match, so it is still refused.
 * The server decides replaceability; this script only acts on the member id it
 * is given and records the new receiver's token.
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
local noSession = ARGV[7]
local replaceablePeer = ARGV[8]
local receiverToken = ARGV[9]

local maxAllowedField = '${F.maxAllowedPeers}'
local connectedPeerField = '${F.connectedPeer}'
local connectedPeersField = '${F.connectedPeers}'
local receiverTokenField = '${F.receiverToken}'
local createdByField = '${F.createdBy}'
local createdAtField = '${F.createdAt}'
local lastActivityField = '${F.lastActivity}'
local peerPrefix = '${P.peer}'

if redis.call('EXISTS', sessionKey) == 0 then
  return {'not-found'}
end

-- The creator would take the only receiver slot from the real receiver.
local createdBy = redis.call('HGET', sessionKey, createdByField)
if createdBy == peerId then
  return {'own-session'}
end

-- One session per peer: joining a second would strand the first one's
-- membership (or, for a creator, the whole session) until its TTL.
local current = redis.call('GET', peerKey)
if current and current ~= noSession and current ~= sessionId then
  return {'busy'}
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
  -- The member is gone (the page was refreshed or closed) or the transfer has
  -- not started, so its slot is free even though its socket or deferred
  -- cleanup may still be around.
  local replacingMember = replaceablePeer ~= '' and connectedPeer == replaceablePeer
  if connectedPeers >= maxAllowed and not replacingMember then
    return {'full'}
  end

  if replacingMember then
    -- The old mapping must not outlive the takeover, or its later cleanup
    -- could delete a mapping that now belongs to this new member.
    local replaceablePeerKey = peerPrefix .. replaceablePeer
    if redis.call('GET', replaceablePeerKey) == sessionId then
      redis.call('DEL', replaceablePeerKey)
    end
    if connectedPeers < 1 then
      redis.call('HSET', sessionKey, connectedPeersField, '1')
      connectedPeers = 1
    end
  else
    connectedPeers = redis.call('HINCRBY', sessionKey, connectedPeersField, 1)
  end

  -- This peer is now the receiver: remember its tab so only that tab can
  -- reclaim the slot after a reload. A takeover rotates the token.
  if receiverToken ~= '' then
    redis.call('HSET', sessionKey, receiverTokenField, receiverToken)
  end
end

redis.call('HSET', sessionKey, connectedPeerField, peerId)
redis.call('HSET', sessionKey, lastActivityField, tostring(now))
redis.call('EXPIRE', sessionKey, ttl)
redis.call('SET', peerKey, sessionId, 'EX', ttl)

if createdBy and createdBy ~= noPeer then
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
  | { status: "own-session" }
  | { status: "busy" }
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
  replaceablePeerId?: string;
  receiverToken?: string;
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
      NO_SESSION,
      params.replaceablePeerId ?? "",
      params.receiverToken ?? "",
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
    case "own-session":
      return { status: "own-session" };
    case "busy":
      return { status: "busy" };
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

/**
 * Writes that must never recreate a session. A plain HSET after a separate
 * existence check recreated `session:<id>` without a TTL when the session
 * expired in between, and that hash then "existed" forever.
 *
 * Every script below returns {'not-found'} when the session is gone, and
 * checks the caller's role inside the same atomic step.
 */

/**
 * Only the creator may describe the file, and only once: the receiver decides
 * whether to accept based on these details, so they must not change under it.
 *
 * KEYS[1] session hash
 * ARGV[1] peerId, ARGV[2] fileName, ARGV[3] mimeType, ARGV[4] fileSize,
 * ARGV[5] now (ms), ARGV[6] "no file" sentinel
 */
export const STORE_METADATA_SCRIPT = `
local sessionKey = KEYS[1]
local peerId = ARGV[1]
local noFile = ARGV[6]

if redis.call('EXISTS', sessionKey) == 0 then
  return {'not-found'}
end
if redis.call('HGET', sessionKey, '${F.createdBy}') ~= peerId then
  return {'forbidden'}
end

local current = redis.call('HGET', sessionKey, '${F.fileName}')
if current and current ~= noFile then
  return {'already-set'}
end

redis.call('HSET', sessionKey,
  '${F.fileName}', ARGV[2],
  '${F.mimeType}', ARGV[3],
  '${F.fileSize}', ARGV[4],
  '${F.lastActivity}', ARGV[5])
return {'ok'}
`;

/**
 * Only the receiver can confirm it has the file. Returns the stored file name
 * so the server, not the client, says what was delivered, and the shortened
 * TTL granted for the post-completion window.
 *
 * KEYS[1] session hash
 * ARGV[1] peerId, ARGV[2] status, ARGV[3] now (ms), ARGV[4] "no file" sentinel,
 * ARGV[5] completed TTL seconds, ARGV[6] max lifetime seconds
 *
 * Returns {status, fileName, ttlSeconds}.
 */
export const COMPLETE_TRANSFER_SCRIPT = `
local sessionKey = KEYS[1]
local peerId = ARGV[1]
local now = tonumber(ARGV[3])
local completedTtl = tonumber(ARGV[5])
local maxLifetime = tonumber(ARGV[6])

if redis.call('EXISTS', sessionKey) == 0 then
  return {'not-found'}
end
if redis.call('HGET', sessionKey, '${F.connectedPeer}') ~= peerId then
  return {'forbidden'}
end

redis.call('HSET', sessionKey,
  '${F.status}', ARGV[2],
  '${F.lastActivity}', ARGV[3])

local fileName = redis.call('HGET', sessionKey, '${F.fileName}')
if not fileName or fileName == ARGV[4] then
  fileName = ''
end

-- Keep the session briefly so both screens can show the result, but never
-- beyond the absolute lifetime cap.
local ttl = completedTtl or 0
local createdAt = tonumber(redis.call('HGET', sessionKey, '${F.createdAt}'))
if createdAt ~= nil and maxLifetime ~= nil and maxLifetime > 0 then
  local remaining = math.floor((createdAt + maxLifetime * 1000 - now) / 1000)
  if remaining < ttl then
    ttl = remaining
  end
end

if ttl <= 0 then
  redis.call('DEL', sessionKey)
else
  redis.call('EXPIRE', sessionKey, ttl)
  local createdBy = redis.call('HGET', sessionKey, '${F.createdBy}')
  local connectedPeer = redis.call('HGET', sessionKey, '${F.connectedPeer}')
  if createdBy and createdBy ~= '${NO_PEER}' then
    redis.call('EXPIRE', '${P.peer}' .. createdBy, ttl)
  end
  if connectedPeer and connectedPeer ~= '${NO_PEER}' then
    redis.call('EXPIRE', '${P.peer}' .. connectedPeer, ttl)
  end
end

return {'ok', fileName, tostring(ttl)}
`;

/**
 * Status change by either peer (both may report an error). When ARGV[3] names
 * a peer, only the session's recorded member may make the change.
 *
 * KEYS[1] session hash
 * ARGV[1] status, ARGV[2] now (ms), ARGV[3] required peer id (empty = any)
 */
export const SET_STATUS_SCRIPT = `
local sessionKey = KEYS[1]
local requiredPeer = ARGV[3]

if redis.call('EXISTS', sessionKey) == 0 then
  return {'not-found'}
end
if requiredPeer ~= '' and redis.call('HGET', sessionKey, '${F.connectedPeer}') ~= requiredPeer then
  return {'forbidden'}
end

redis.call('HSET', sessionKey,
  '${F.status}', ARGV[1],
  '${F.lastActivity}', ARGV[2])
return {'ok'}
`;

export type GuardedWriteStatus =
  | "ok"
  | "not-found"
  | "forbidden"
  | "already-set";

const toGuardedStatus = (value: unknown): GuardedWriteStatus => {
  const status = String(value ?? "not-found");
  return status === "ok" || status === "forbidden" || status === "already-set"
    ? status
    : "not-found";
};

export const runStoreMetadataScript = async (params: {
  sessionId: string;
  peerId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<GuardedWriteStatus> => {
  const reply = (await redisClient.eval(STORE_METADATA_SCRIPT, {
    keys: [sessionStorageKey(params.sessionId)],
    arguments: [
      params.peerId,
      params.fileName,
      params.mimeType,
      params.fileSize.toString(),
      Date.now().toString(),
      NO_FILE_SELECTED,
    ],
  })) as unknown[] | null;

  return toGuardedStatus(reply?.[0]);
};

export const runCompleteTransferScript = async (params: {
  sessionId: string;
  peerId: string;
  status: string;
  completedTtlSeconds: number;
  maxLifetimeSeconds: number;
}): Promise<{
  status: GuardedWriteStatus;
  fileName: string;
  ttlSeconds: number;
}> => {
  const reply = (await redisClient.eval(COMPLETE_TRANSFER_SCRIPT, {
    keys: [sessionStorageKey(params.sessionId)],
    arguments: [
      params.peerId,
      params.status,
      Date.now().toString(),
      NO_FILE_SELECTED,
      params.completedTtlSeconds.toString(),
      params.maxLifetimeSeconds.toString(),
    ],
  })) as unknown[] | null;

  return {
    status: toGuardedStatus(reply?.[0]),
    fileName: reply?.[1] === undefined ? "" : String(reply[1]),
    ttlSeconds: reply?.[2] === undefined ? 0 : Number(reply[2]),
  };
};

export const runSetStatusScript = async (params: {
  sessionId: string;
  status: string;
  requiredPeerId?: string;
}): Promise<GuardedWriteStatus> => {
  const reply = (await redisClient.eval(SET_STATUS_SCRIPT, {
    keys: [sessionStorageKey(params.sessionId)],
    arguments: [
      params.status,
      Date.now().toString(),
      params.requiredPeerId ?? "",
    ],
  })) as unknown[] | null;

  return toGuardedStatus(reply?.[0]);
};
