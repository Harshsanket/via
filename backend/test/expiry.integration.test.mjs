// Session lifetime and expiry push.
//
// Runs its own server with a deliberately tiny lifetime so the whole
// expiry cycle takes seconds instead of the production 24 hours.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createSession,
  emitAck,
  makeClientPool,
  startTestServer,
  stopTestServer,
  waitFor,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_EXPIRY_PORT ?? 41732);
const LIFETIME_SECONDS = 8;
const WARNING_SECONDS = 3;
const SESSION_TTL_SECONDS = 3;
const REFRESH_SESSION_TTL_SECONDS = 5;

let baseUrl;
let server;
let log;
let pool;

before(async () => {
  ({ server, baseUrl, log } = await startTestServer({
    port: PORT,
    env: {
      SESSION_TTL_SECONDS: String(SESSION_TTL_SECONDS),
      REFRESH_SESSION_TTL_SECONDS: String(REFRESH_SESSION_TTL_SECONDS),
      SESSION_MAX_LIFETIME_SECONDS: String(LIFETIME_SECONDS),
      SESSION_EXPIRY_WARNING_SECONDS: String(WARNING_SECONDS),
    },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("session and refresh ttls come from the environment", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);

  const initialTtl = waitFor(sender, "session:ttl");
  sender.emit("get-ttl", { sessionId });
  const initial = await initialTtl;
  assert.equal(initial?.exists, true);
  assert.ok(
    initial.ttl > 0 && initial.ttl <= SESSION_TTL_SECONDS,
    `ttl ${initial.ttl} should be capped at ${SESSION_TTL_SECONDS}`,
  );

  await emitAck(receiver, "join-session", { sessionId });

  const refreshedTtl = waitFor(sender, "session:ttl");
  sender.emit("get-ttl", { sessionId });
  const refreshed = await refreshedTtl;
  assert.ok(
    refreshed.ttl > 0 && refreshed.ttl <= REFRESH_SESSION_TTL_SECONDS,
    `ttl ${refreshed.ttl} should be capped at ${REFRESH_SESSION_TTL_SECONDS}`,
  );

  sender.disconnect();
  receiver.disconnect();
});

test("expiry is pushed to the room and the session really ends", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);
  await emitAck(receiver, "join-session", { sessionId });

  // Subscribe before the timers fire: the warning is due WARNING_SECONDS
  // before the end of the lifetime.
  const expiring = waitFor(receiver, "session:expiring", 10_000);
  const expired = waitFor(receiver, "session:expired", 15_000);

  const expiringPayload = await expiring;
  assert.equal(expiringPayload?.sessionId, sessionId);
  assert.equal(expiringPayload.secondsRemaining, WARNING_SECONDS);

  const expiredPayload = await expired;
  assert.equal(expiredPayload?.sessionId, sessionId);

  // Redis stays the authority: the session is genuinely gone, not just
  // announced as gone.
  const late = await pool.connect();
  const lateJoin = await emitAck(late, "join-session", { sessionId });
  assert.equal(lateJoin?.success, false, `log: ${log.text}`);
  assert.equal(lateJoin.message, "session expired or invalid");

  sender.disconnect();
  receiver.disconnect();
  late.disconnect();
});

test("the expiry push keeps working after a member leaves", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);
  await emitAck(receiver, "join-session", { sessionId });

  const peerLeft = waitFor(sender, "peer-left");
  receiver.disconnect();
  await peerLeft;

  // A member leaving must not cancel the creator's session or its timers.
  const expired = waitFor(sender, "session:expired", 15_000);
  const payload = await expired;
  assert.equal(payload?.sessionId, sessionId);

  sender.disconnect();
});
