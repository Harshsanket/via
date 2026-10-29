// After a completed transfer the session must close on a short, configured
// timer rather than the normal refresh lifetime.
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

const PORT = Number(process.env.TEST_COMPLETED_TTL_PORT ?? 41735);
const COMPLETED_TTL_SECONDS = 2;

let baseUrl;
let server;
let pool;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: {
      SESSION_TTL_SECONDS: "60",
      REFRESH_SESSION_TTL_SECONDS: "60",
      SESSION_MAX_LIFETIME_SECONDS: "120",
      SESSION_EXPIRY_WARNING_SECONDS: "0",
      COMPLETED_SESSION_TTL_SECONDS: String(COMPLETED_TTL_SECONDS),
    },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("completion shortens the session to the configured window", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);
  await emitAck(receiver, "join-session", { sessionId });

  const expiring = waitFor(receiver, "session:expiring", 5_000);
  const expired = waitFor(receiver, "session:expired", 10_000);

  const ack = await emitAck(receiver, "transfer-complete", {
    sessionId,
    fileName: "done.bin",
  });
  assert.equal(ack?.success, true);

  const expiringPayload = await expiring;
  assert.equal(expiringPayload?.sessionId, sessionId);
  assert.equal(expiringPayload?.secondsRemaining, COMPLETED_TTL_SECONDS);

  const expiredPayload = await expired;
  assert.equal(expiredPayload?.sessionId, sessionId);

  sender.disconnect();
  receiver.disconnect();
});
