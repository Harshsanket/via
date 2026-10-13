// End-to-end socket tests. They boot the built server (dist/src/server.js)
// against a real Redis (and coturn, for the ICE tests) and talk to it with the
// official client.
//
//   docker compose up -d --wait
//   npm run test:integration
//
// Requires a build first (`npm run build`), because the server under test is
// the compiled artifact that production also runs.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createSession,
  emitAck,
  makeClientPool,
  startTestServer,
  stopTestServer,
  waitFor,
  waitForHealth,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_PORT ?? 41731);
const ALLOWED_ORIGIN = "http://allowed.example";

let baseUrl;
let server;
let log;
let pool;

before(async () => {
  ({ server, baseUrl, log } = await startTestServer({
    port: PORT,
    env: { CLIENT_ORIGIN: ALLOWED_ORIGIN },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("health endpoint reports Redis as up", async () => {
  const { status, body } = await waitForHealth(baseUrl);

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.data.checks, { redis: true });
});

test("CORS reflects an allowed origin and omits the header otherwise", async () => {
  const allowed = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: ALLOWED_ORIGIN },
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    ALLOWED_ORIGIN,
  );
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

  const foreign = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: "http://evil.example" },
  });
  assert.equal(
    foreign.headers.get("access-control-allow-origin"),
    null,
    "a foreign origin must not receive an allow-origin header",
  );
});

test("create, join, store metadata and read it back", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);

  const peerJoined = waitFor(sender, "peer-joined");
  const joinAck = await emitAck(receiver, "join-session", { sessionId });
  await peerJoined;

  assert.equal(joinAck?.success, true, `join failed: ${joinAck?.message}`);

  // No file selected yet: null, not the old "NOT_SELECTED" placeholder.
  assert.equal(joinAck.metadata, null);

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "holiday.png",
    mimeType: "image/png",
    fileSize: 2048,
  });

  const storedPayload = await stored;
  assert.equal(storedPayload?.success, true);
  assert.equal(storedPayload.sessionId, sessionId);
  assert.deepEqual(storedPayload.metadata, {
    fileName: "holiday.png",
    mimeType: "image/png",
    fileSize: 2048,
  });

  const readBack = waitFor(receiver, "file-metadata");
  receiver.emit("get-file-metadata", { sessionId, peerId: receiver.id });
  const readPayload = await readBack;

  assert.equal(readPayload?.success, true);
  assert.deepEqual(readPayload.metadata, {
    fileName: "holiday.png",
    mimeType: "image/png",
    fileSize: 2048,
  });

  sender.disconnect();
  receiver.disconnect();
});

test("a third peer is rejected once the session is full", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const intruder = await pool.connect();

  const sessionId = await createSession(sender);

  const first = await emitAck(receiver, "join-session", { sessionId });
  assert.equal(first?.success, true);

  const second = await emitAck(intruder, "join-session", { sessionId });
  assert.equal(second?.success, false);
  assert.equal(second.message, "session is full");

  sender.disconnect();
  receiver.disconnect();
  intruder.disconnect();
});

test("simultaneous joins cannot both take the only slot", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  // Five peers join in the same tick. The limit check and the membership write
  // happen inside one Lua script, so exactly one can win.
  const contenders = await Promise.all(
    Array.from({ length: 5 }, () => pool.connect()),
  );

  const results = await Promise.all(
    contenders.map((socket) => emitAck(socket, "join-session", { sessionId })),
  );

  const accepted = results.filter((result) => result?.success === true);
  const rejected = results.filter((result) => result?.success === false);

  assert.equal(accepted.length, 1, `expected 1 winner, got ${accepted.length}`);
  assert.equal(rejected.length, 4);
  for (const rejection of rejected) {
    assert.equal(rejection.message, "session is full");
  }

  sender.disconnect();
  for (const socket of contenders) socket.disconnect();
});

test("rejoining as the same peer is idempotent", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const other = await pool.connect();

  const sessionId = await createSession(sender);

  const first = await emitAck(receiver, "join-session", { sessionId });
  assert.equal(first?.success, true);

  // Same peer, same session: must not consume a second slot.
  const again = await emitAck(receiver, "join-session", { sessionId });
  assert.equal(again?.success, true, `rejoin failed: ${again?.message}`);

  // The session is still 1:1 from a third peer's point of view.
  const third = await emitAck(other, "join-session", { sessionId });
  assert.equal(third?.success, false);
  assert.equal(third.message, "session is full");

  sender.disconnect();
  receiver.disconnect();
  other.disconnect();
});

test("a peer cannot own two sessions at once", async () => {
  const sender = await pool.connect();

  await createSession(sender);
  const second = await emitAck(sender, "create-session");

  assert.equal(second?.success, false);
  assert.equal(second.message, "peer already in session");

  sender.disconnect();
});

test("metadata of a session a peer never joined is not readable", async () => {
  const sender = await pool.connect();
  const outsider = await pool.connect();

  const sessionId = await createSession(sender);

  const errorEvent = waitFor(outsider, "session:error");
  outsider.emit("get-file-metadata", { sessionId, peerId: outsider.id });

  const payload = await errorEvent;
  assert.equal(payload?.success, false);
  assert.equal(payload.message, "unauthorized session access");

  sender.disconnect();
  outsider.disconnect();
});

test("a malformed payload is answered and the server stays up", async () => {
  const sender = await pool.connect();

  // No payload and no ack callback: the shape that previously crashed the
  // process with a TypeError inside the listener.
  const errorEvent = waitFor(sender, "session:error");
  sender.emit("join-session");

  const payload = await errorEvent;
  assert.equal(payload?.success, false);

  const { status } = await waitForHealth(baseUrl);
  assert.equal(status, 200, "server should still be healthy");

  // And the socket is still usable.
  const sessionId = await createSession(sender);
  assert.equal(typeof sessionId, "string");

  sender.disconnect();
});

test("a socket can report more than one completed transfer", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);
  await emitAck(receiver, "join-session", { sessionId });

  const firstReceived = waitFor(receiver, "transfer-complete");
  const firstAck = await emitAck(sender, "transfer-complete", {
    sessionId,
    fileName: "holiday.png",
  });
  assert.equal(firstAck?.success, true);
  assert.equal((await firstReceived)?.fileName, "holiday.png");

  const secondReceived = waitFor(receiver, "transfer-complete");
  const secondAck = await emitAck(sender, "transfer-complete", {
    sessionId,
    fileName: "holiday-2.png",
  });
  assert.equal(secondAck?.success, true);
  assert.equal((await secondReceived)?.fileName, "holiday-2.png");

  sender.disconnect();
  receiver.disconnect();
});

test("leaving peers are announced and the session is cleaned up", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();

  const sessionId = await createSession(sender);
  await emitAck(receiver, "join-session", { sessionId });

  const peerLeft = waitFor(sender, "peer-left");
  receiver.disconnect();
  await peerLeft;

  const ttl = waitFor(sender, "session:ttl");
  sender.emit("get-ttl", { sessionId });
  const ttlPayload = await ttl;
  assert.equal(ttlPayload?.exists, true);
  assert.ok(
    ttlPayload.ttl > 0 && ttlPayload.ttl <= 1800,
    `ttl: ${ttlPayload.ttl}`,
  );

  // When the creator disconnects the session is gone for everyone. Cleanup is
  // asynchronous on the server, so poll instead of assuming it already ran.
  sender.disconnect();

  const late = await pool.connect();
  const deadline = Date.now() + 5_000;
  let lastJoin = null;
  while (Date.now() < deadline) {
    lastJoin = await emitAck(late, "join-session", { sessionId });
    if (lastJoin?.success === false) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  assert.equal(
    lastJoin?.success,
    false,
    `session should be gone. log: ${log.text}`,
  );
  assert.equal(lastJoin.message, "session expired or invalid");

  late.disconnect();
});
