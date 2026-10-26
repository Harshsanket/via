// A minimal TURN client: just enough of RFC 5389 / RFC 5766 to perform a real
// Allocate over TCP, so a test can ask coturn whether a minted credential is
// actually accepted rather than merely well-formed.
//
// Not a test file itself, so the `test/*.test.mjs` glob does not pick it up.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { connect } from "node:net";

const HEADER_LENGTH = 20;
const MAGIC_COOKIE = 0x2112a442;

// STUN message types are hand-encoded (method bits interleaved with class
// bits), so the ones used here are named rather than computed.
const ALLOCATE_REQUEST = 0x0003;
const ALLOCATE_SUCCESS = 0x0103;

const ATTRIBUTE = {
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
};

const PADDED = (length) => (length + 3) & ~3;

const encodeAttribute = (type, value) => {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([
    header,
    value,
    Buffer.alloc(PADDED(value.length) - value.length),
  ]);
};

const encodeHeader = (type, bodyLength, transactionId) => {
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(bodyLength, 2);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);
  return header;
};

const buildAllocate = ({ username, realm, nonce, credential }) => {
  const transactionId = randomBytes(12);
  // 17 is UDP: the relay port the browser will ask for.
  const attributes = [
    encodeAttribute(ATTRIBUTE.requestedTransport, Buffer.from([17, 0, 0, 0])),
  ];

  if (username && realm && nonce && credential) {
    attributes.push(
      encodeAttribute(ATTRIBUTE.username, Buffer.from(username, "utf8")),
      encodeAttribute(ATTRIBUTE.realm, Buffer.from(realm, "utf8")),
      encodeAttribute(ATTRIBUTE.nonce, Buffer.from(nonce, "utf8")),
    );

    // The header length must already include the MESSAGE-INTEGRITY attribute
    // that is appended afterwards (RFC 5389 section 15.4).
    const body = Buffer.concat(attributes);
    const signed = Buffer.concat([
      encodeHeader(ALLOCATE_REQUEST, body.length + 24, transactionId),
      body,
    ]);
    const key = createHash("md5")
      .update(`${username}:${realm}:${credential}`)
      .digest();
    const integrity = createHmac("sha1", key).update(signed).digest();

    return Buffer.concat([
      signed,
      encodeAttribute(ATTRIBUTE.messageIntegrity, integrity),
    ]);
  }

  const body = Buffer.concat(attributes);
  return Buffer.concat([
    encodeHeader(ALLOCATE_REQUEST, body.length, transactionId),
    body,
  ]);
};

const parseAttributes = (message) => {
  const attributes = [];
  let offset = HEADER_LENGTH;

  while (offset + 4 <= message.length) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    attributes.push({
      type,
      value: message.subarray(offset + 4, offset + 4 + length),
    });
    offset += 4 + PADDED(length);
  }

  return attributes;
};

const findAttribute = (attributes, type) =>
  attributes.find((attribute) => attribute.type === type)?.value ?? null;

const decodeErrorCode = (value) => {
  if (!value || value.length < 4) return { code: null, reason: null };
  return {
    code: (value[2] & 0x07) * 100 + value[3],
    reason: value.subarray(4).toString("utf8"),
  };
};

const decodeXorAddress = (value) => {
  if (!value || value.length < 8) return null;
  const family = value[1];
  if (family !== 0x01) return "non-ipv4 relay address";
  const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);
  const address = Buffer.alloc(4);
  for (let index = 0; index < 4; index += 1) {
    address[index] = value[4 + index] ^ (MAGIC_COOKIE >>> (24 - index * 8));
  }
  return `${address.join(".")}:${port}`;
};

/** Frames STUN messages arriving on one TCP connection. */
const createReader = (socket) => {
  let buffer = Buffer.alloc(0);
  const waiting = [];

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= HEADER_LENGTH) {
      const length = buffer.readUInt16BE(2);
      if (buffer.length < HEADER_LENGTH + length) return;
      const message = buffer.subarray(0, HEADER_LENGTH + length);
      buffer = buffer.subarray(HEADER_LENGTH + length);
      waiting.shift()?.(message);
    }
  });

  return () => new Promise((resolve) => waiting.push(resolve));
};

const withTimeout = (promise, timeoutMs, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs,
      ).unref(),
    ),
  ]);

/**
 * Parses a TURN URI so a test can allocate against the exact address the
 * endpoint handed to the client. Returns null for anything malformed.
 */
export const parseTurnUrl = (url) => {
  const match = /^(turns?):([^:?]+):(\d+)(\?(.*))?$/i.exec(String(url).trim());
  if (!match) return null;

  return {
    scheme: match[1].toLowerCase(),
    host: match[2],
    port: Number(match[3]),
    transport: (
      new URLSearchParams(match[5] ?? "").get("transport") ?? "udp"
    ).toLowerCase(),
  };
};

/**
 * Performs a real TURN Allocate against `host:port` using the supplied
 * credentials and reports what the relay answered.
 *
 * The whole exchange runs on a single connection because coturn binds its nonce
 * to the client's source address: a second connection would be challenged
 * again before the credentials were ever looked at.
 */
export const turnAllocate = async ({
  host,
  port,
  username = "",
  credential = "",
  timeoutMs = 5_000,
}) => {
  const socket = connect({ host, port });
  const next = createReader(socket);

  try {
    await withTimeout(once(socket, "connect"), timeoutMs, "tcp connect");

    // An unauthenticated Allocate is what makes the relay hand back its realm
    // and nonce; the credentials are only checked on the retry.
    socket.write(buildAllocate({}));
    const challenge = await withTimeout(
      next(),
      timeoutMs,
      "allocate challenge",
    );
    const challengeAttributes = parseAttributes(challenge);

    if (challenge.readUInt16BE(0) === ALLOCATE_SUCCESS) {
      return {
        authenticated: true,
        errorCode: null,
        errorReason: null,
        realm: null,
        relayedAddress: decodeXorAddress(
          findAttribute(challengeAttributes, ATTRIBUTE.xorRelayedAddress),
        ),
      };
    }

    const realm = findAttribute(challengeAttributes, ATTRIBUTE.realm);
    const nonce = findAttribute(challengeAttributes, ATTRIBUTE.nonce);
    const challengeError = decodeErrorCode(
      findAttribute(challengeAttributes, ATTRIBUTE.errorCode),
    );

    if (!realm || !nonce) {
      return {
        authenticated: false,
        errorCode: challengeError.code,
        errorReason: challengeError.reason,
        realm: realm?.toString("utf8") ?? null,
        relayedAddress: null,
      };
    }

    const realmValue = realm.toString("utf8");
    const nonceValue = nonce.toString("utf8");

    socket.write(
      buildAllocate({
        username,
        realm: realmValue,
        nonce: nonceValue,
        credential,
      }),
    );
    const response = await withTimeout(
      next(),
      timeoutMs,
      "authenticated allocate",
    );
    const attributes = parseAttributes(response);
    const error = decodeErrorCode(
      findAttribute(attributes, ATTRIBUTE.errorCode),
    );

    return {
      authenticated: response.readUInt16BE(0) === ALLOCATE_SUCCESS,
      errorCode: error.code,
      errorReason: error.reason,
      realm: realmValue,
      relayedAddress: decodeXorAddress(
        findAttribute(attributes, ATTRIBUTE.xorRelayedAddress),
      ),
    };
  } finally {
    socket.destroy();
  }
};
