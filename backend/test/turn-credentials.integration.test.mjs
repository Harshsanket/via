// Do the credentials the endpoint mints actually open a relay port?
//
// This is the acceptance test for the credential half of Phase 2: it takes the
// ICE configuration the server hands a client, performs a real TURN Allocate
// against coturn with it, and checks the three refusals that make the
// credentials time limited rather than merely secret.
//
// Needs the coturn service from docker-compose.yml: `npm run db:up`.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import {
  createSession,
  makeClientPool,
  startTestServer,
  stopTestServer,
} from "./socket-test-helpers.mjs";
import { parseTurnUrl, turnAllocate } from "./turn-client.mjs";

const PORT = Number(process.env.TEST_TURN_PORT ?? 41734);

// Shared with the coturn service in docker-compose.yml.
const TURN_SECRET = process.env.TURN_SECRET ?? "via-dev-turn-secret";
const TURN_URL =
  process.env.TEST_TURN_URL ?? "turn:127.0.0.1:3478?transport=tcp";

let baseUrl;
let server;
let pool;

const relay = parseTurnUrl(TURN_URL);

const allocate = async (options) => {
  try {
    return await turnAllocate({
      ...options,
      host: relay.host,
      port: relay.port,
    });
  } catch (error) {
    throw new Error(
      `could not reach the relay at ${relay.host}:${relay.port} :: ${error.message} :: ` +
        `start it with "npm run db:up"`,
    );
  }
};

/** The ICE configuration exactly as the client would receive it. */
const fetchIceConfiguration = async (sessionId) => {
  const response = await fetch(
    `${baseUrl}/api/v1/ice-servers?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(response.status, 200, "the endpoint should issue credentials");
  const body = await response.json();
  return body.data.iceServers.find((entry) => entry.username);
};

before(async () => {
  if (!relay) throw new Error(`not a TURN url: ${TURN_URL}`);
  if (relay.transport !== "tcp") {
    throw new Error(`this client allocates over tcp, got ${relay.transport}`);
  }

  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: {
      TURN_URLS: TURN_URL,
      TURN_SECRET,
      TURN_TTL_SECONDS: "3600",
    },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("the relay accepts the credential the endpoint issued", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const turn = await fetchIceConfiguration(sessionId);
  const result = await allocate({
    username: turn.username,
    credential: turn.credential,
  });

  assert.equal(
    result.authenticated,
    true,
    `relay refused the minted credential (${result.errorCode} ${result.errorReason})`,
  );
  assert.match(
    result.relayedAddress ?? "",
    /^\d+\.\d+\.\d+\.\d+:\d+$/,
    "an accepted allocation must come back with a relay address",
  );
  assert.equal(result.realm, "via.local");

  socket.disconnect();
});

test("the relay rejects a credential that was tampered with", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const turn = await fetchIceConfiguration(sessionId);
  const tampered = `${turn.credential.slice(0, 1) === "A" ? "B" : "A"}${turn.credential.slice(1)}`;

  const result = await allocate({
    username: turn.username,
    credential: tampered,
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.errorCode, 401);

  socket.disconnect();
});

test("the relay rejects a credential signed with another secret", async () => {
  const socket = await pool.connect();
  const sessionId = await createSession(socket);

  const turn = await fetchIceConfiguration(sessionId);
  const forged = createHmac("sha1", "not-the-shared-secret")
    .update(turn.username)
    .digest("base64");

  const result = await allocate({
    username: turn.username,
    credential: forged,
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.errorCode, 401);

  socket.disconnect();
});

test("the relay rejects an expired username", async () => {
  // Signed correctly, but for a moment that has already passed: expiry has to
  // be enforced by the relay, not merely recorded in the username.
  const expiresAt = Math.floor(Date.now() / 1000) - 60;
  const username = `${expiresAt}:expired-test`;
  const credential = createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");

  const result = await allocate({ username, credential });

  assert.equal(result.authenticated, false);
  assert.equal(result.errorCode, 401);
});
