// GET /api/v1/ice-servers: the credentials clients use to reach a relay.
//
// The credential *format* is verified here against an independent HMAC
// computation; whether a real relay accepts it is
// test/turn-credentials.integration.test.mjs.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import {
  createSession,
  makeClientPool,
  startTestServer,
  stopTestServer,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_ICE_PORT ?? 41733);
const UNCONFIGURED_PORT = PORT + 1;
const INVALID_URLS_PORT = PORT + 2;

const TURN_SECRET = "via-test-turn-secret";
const TTL_SECONDS = 3_600;
const TURN_URL = "turn:relay.test:3478?transport=udp";
const STUN_URL = "stun:stun.test:3478";

let baseUrl;
let server;
let pool;

let unconfiguredServer;
let unconfiguredBaseUrl;
let unconfiguredPool;

let invalidUrlsServer;
let invalidUrlsBaseUrl;
let invalidUrlsPool;

const fetchIceServers = async (url, sessionId) => {
  const query =
    sessionId === undefined
      ? ""
      : `?sessionId=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${url}/api/v1/ice-servers${query}`);
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
};

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: {
      TURN_URLS: TURN_URL,
      TURN_SECRET,
      TURN_TTL_SECONDS: String(TTL_SECONDS),
      STUN_URLS: STUN_URL,
    },
  }));
  pool = makeClientPool(baseUrl);

  // No relay at all.
  const noRelay = await startTestServer({ port: UNCONFIGURED_PORT });
  unconfiguredServer = noRelay.server;
  unconfiguredBaseUrl = noRelay.baseUrl;
  unconfiguredPool = makeClientPool(unconfiguredBaseUrl);

  // A secret and a URL, but the URL is not a TURN URI.
  const invalidUrlsResult = await startTestServer({
    port: INVALID_URLS_PORT,
    env: {
      TURN_URLS: "http://relay.test:3478",
      TURN_SECRET,
    },
  });
  invalidUrlsServer = invalidUrlsResult.server;
  invalidUrlsBaseUrl = invalidUrlsResult.baseUrl;
  invalidUrlsPool = makeClientPool(invalidUrlsBaseUrl);
});

after(async () => {
  pool?.closeAll();
  unconfiguredPool?.closeAll();
  invalidUrlsPool?.closeAll();
  await stopTestServer(server);
  await stopTestServer(unconfiguredServer);
  await stopTestServer(invalidUrlsServer);
});

test("issues stun and relay entries for a live session", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const { status, body } = await fetchIceServers(baseUrl, sessionId);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.ttlSeconds, TTL_SECONDS);

  const [stun, turn] = body.data.iceServers;
  assert.deepEqual(stun, { urls: [STUN_URL] }, "stun entry carries no secrets");
  assert.deepEqual(turn.urls, [TURN_URL]);
  assert.equal(typeof turn.username, "string");
  assert.equal(typeof turn.credential, "string");

  socket.disconnect();
});

test("the username embeds the expiry the response reports", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const before = Math.floor(Date.now() / 1000);
  const { body } = await fetchIceServers(baseUrl, sessionId);
  const after = Math.floor(Date.now() / 1000);

  const turn = body.data.iceServers.find((entry) => entry.username);
  const [timestamp, suffix] = turn.username.split(":");

  assert.equal(Number(timestamp), body.data.expiresAt);
  assert.ok(
    Number(timestamp) >= before + TTL_SECONDS &&
      Number(timestamp) <= after + TTL_SECONDS,
    `expiry ${timestamp} should be now + ${TTL_SECONDS}`,
  );
  // The id after the colon is what makes credentials traceable in relay logs.
  assert.match(suffix, /^[0-9a-f-]{36}$/);

  socket.disconnect();
});

test("the credential is the shared secret's HMAC of the username", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const { body } = await fetchIceServers(baseUrl, sessionId);
  const turn = body.data.iceServers.find((entry) => entry.username);

  // Recomputed here rather than with the server's own helper: this is the
  // TURN REST API rule, and coturn verifies exactly this value.
  const expected = createHmac("sha1", TURN_SECRET)
    .update(turn.username)
    .digest("base64");

  assert.equal(body.data.algorithm, "sha1");
  assert.equal(turn.credential, expected);

  socket.disconnect();
});

test("every request gets its own credentials", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const first = await fetchIceServers(baseUrl, sessionId);
  const second = await fetchIceServers(baseUrl, sessionId);

  const usernameOf = (result) =>
    result.body.data.iceServers.find((entry) => entry.username).username;

  assert.notEqual(usernameOf(first), usernameOf(second));
  assert.equal(first.body.data.expiresAt, second.body.data.expiresAt);

  socket.disconnect();
});

test("credentials are never cached", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const { cacheControl } = await fetchIceServers(baseUrl, sessionId);
  assert.match(cacheControl ?? "", /no-store/);
  assert.match(cacheControl ?? "", /private/);

  socket.disconnect();
});

test("an unknown session cannot obtain credentials", async () => {
  const { status, body } = await fetchIceServers(
    baseUrl,
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.equal(body.message, "session expired or invalid");
});

test("a missing session id is rejected", async () => {
  const { status, body } = await fetchIceServers(baseUrl, undefined);
  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test("a server with no relay configured refuses rather than pretending", async () => {
  const socket = await unconfiguredPool.connect();
  const sessionId = await createSession(socket);

  const { status, body } = await fetchIceServers(
    unconfiguredBaseUrl,
    sessionId,
  );
  assert.equal(status, 503);
  assert.equal(body.success, false);
  assert.equal(body.message, "relay is not configured");

  socket.disconnect();
});

test("a non-turn relay url counts as no relay", async () => {
  const socket = await invalidUrlsPool.connect();
  const sessionId = await createSession(socket);

  const { status } = await fetchIceServers(invalidUrlsBaseUrl, sessionId);
  assert.equal(status, 503);

  socket.disconnect();
});
