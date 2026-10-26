// Session bookkeeping under hostile or unlucky clients: joining the wrong
// session, connection recovery, peers acting outside their role, and writes
// racing a session's deletion. Each test pins one finding from the security
// review (H4, M1, M2, M6).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "redis";
import { io as ioClient } from "socket.io-client";
import {
  REDIS_URL,
  createSession,
  emitAck,
  makeClientPool,
  startTestServer,
  stopTestServer,
  waitFor,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_INTEGRITY_PORT ?? 41751);

let baseUrl;
let server;
let pool;
let redis;

before(async () => {
  ({ server, baseUrl } = await startTestServer({ port: PORT }));
  pool = makeClientPool(baseUrl);
  redis = createClient({ url: REDIS_URL });
  await redis.connect();
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
  await redis?.quit();
});

/** Polls Redis until `check` passes; cleanup on the server is asynchronous. */
const eventually = async (check, message, timeout = 3_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
};

const sessionExists = async (sessionId) =>
  (await redis.exists(`session:${sessionId}`)) === 1;

// --------------------------------------------------------------------- H4

test("H4: the creator cannot take the receiver slot of their own session", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const sessionId = await createSession(sender);

  const selfJoin = await emitAck(sender, "join-session", { sessionId });
  assert.equal(selfJoin?.success, false, "a creator must not join itself");

  const join = await emitAck(receiver, "join-session", { sessionId });
  assert.equal(
    join?.success,
    true,
    `receiver was locked out: ${join?.message}`,
  );

  sender.disconnect();
  receiver.disconnect();
});

test("H4: a receiver in one session cannot join another", async () => {
  const senderA = await pool.connect();
  const senderB = await pool.connect();
  const receiver = await pool.connect();

  const sessionA = await createSession(senderA);
  const sessionB = await createSession(senderB);

  assert.equal(
    (await emitAck(receiver, "join-session", { sessionId: sessionA }))?.success,
    true,
  );

  const second = await emitAck(receiver, "join-session", {
    sessionId: sessionB,
  });
  assert.equal(second?.success, false, "a second session must be refused");
  assert.equal(await redis.get(`peer:${receiver.id}`), sessionA);

  // Leaving must still free A's only slot for someone else.
  const leftA = waitFor(senderA, "peer-left");
  receiver.disconnect();
  await leftA;

  const replacement = await pool.connect();
  const rejoin = await emitAck(replacement, "join-session", {
    sessionId: sessionA,
  });
  assert.equal(rejoin?.success, true, `A stayed full: ${rejoin?.message}`);

  senderA.disconnect();
  senderB.disconnect();
  replacement.disconnect();
});

test("H4: a creator who tries another session still tears theirs down", async () => {
  const senderA = await pool.connect();
  const senderB = await pool.connect();

  const sessionA = await createSession(senderA);
  const sessionB = await createSession(senderB);

  const cross = await emitAck(senderA, "join-session", { sessionId: sessionB });
  assert.equal(
    cross?.success,
    false,
    "a creator must not join another session",
  );

  senderA.disconnect();
  await eventually(
    async () => !(await sessionExists(sessionA)),
    "the creator's session outlived its creator",
  );
  assert.equal(
    await redis.exists(`peer-sessions:${senderA.id}`),
    0,
    "the creator's session slot leaked",
  );

  senderB.disconnect();
});

// --------------------------------------------------------------------- M1

test("M1: a recovered connection keeps its session and mapping", async () => {
  const sender = ioClient(baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnectionDelay: 100,
    reconnectionDelayMax: 200,
  });
  await waitFor(sender, "connect");

  try {
    const sessionId = await createSession(sender);
    const peerId = sender.id;
    assert.equal(await redis.get(`peer:${peerId}`), sessionId);

    // Recovery needs at least one received event (it resumes from its
    // offset). The real sender always gets file-metadata at this point.
    const stored = waitFor(sender, "file-metadata");
    sender.emit("store-file-metadata", {
      sessionId,
      fileName: "report.pdf",
      mimeType: "application/pdf",
      fileSize: 1000,
    });
    await stored;

    // Drop the transport without a clean disconnect, as a phone switching
    // networks would. Socket.IO restores the same socket id on reconnect.
    sender.io.engine.close();
    await waitFor(sender, "connect");
    assert.equal(sender.recovered, true, "the connection was not recovered");
    assert.equal(sender.id, peerId);

    assert.equal(
      await sessionExists(sessionId),
      true,
      "a dropped transport destroyed the session before it could recover",
    );

    assert.equal(
      await redis.get(`peer:${peerId}`),
      sessionId,
      "reconnecting wiped the peer's session mapping",
    );

    // With the mapping intact, a real departure ends the session.
    sender.disconnect();
    await eventually(
      async () => !(await sessionExists(sessionId)),
      "the session outlived its creator after a recovered connection",
    );
  } finally {
    sender.disconnect();
  }
});

// --------------------------------------------------------------------- M2

test("M2: the receiver cannot overwrite the sender's file details", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const sessionId = await createSession(sender);

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "report.pdf",
    mimeType: "application/pdf",
    fileSize: 1000,
  });
  await stored;

  await emitAck(receiver, "join-session", { sessionId });

  const refused = waitFor(receiver, "session:error");
  receiver.emit("store-file-metadata", {
    sessionId,
    fileName: "evil.exe",
    mimeType: "application/octet-stream",
    fileSize: 1,
  });
  assert.equal((await refused)?.success, false);

  assert.equal(
    await redis.hGet(`session:${sessionId}`, "fileName"),
    "report.pdf",
  );

  sender.disconnect();
  receiver.disconnect();
});

test("M2: the sender cannot swap the file details once set", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const first = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "report.pdf",
    mimeType: "application/pdf",
    fileSize: 1000,
  });
  await first;

  const refused = waitFor(sender, "session:error");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "other.exe",
    mimeType: "application/octet-stream",
    fileSize: 5,
  });
  assert.equal((await refused)?.success, false);
  assert.equal(
    await redis.hGet(`session:${sessionId}`, "fileName"),
    "report.pdf",
  );

  sender.disconnect();
});

test("M2: only the receiver confirms completion, with the stored name", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const sessionId = await createSession(sender);

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "report.pdf",
    mimeType: "application/pdf",
    fileSize: 1000,
  });
  await stored;
  await emitAck(receiver, "join-session", { sessionId });

  const fromSender = await emitAck(sender, "transfer-complete", {
    sessionId,
    fileName: "report.pdf",
  });
  assert.equal(fromSender?.success, false, "the sender cannot confirm receipt");

  const confirmed = waitFor(sender, "transfer-complete");
  const fromReceiver = await emitAck(receiver, "transfer-complete", {
    sessionId,
    fileName: "something-else.exe",
  });
  assert.equal(fromReceiver?.success, true, fromReceiver?.message);
  assert.equal(
    (await confirmed)?.fileName,
    "report.pdf",
    "the relayed name must come from the server, not the client",
  );

  sender.disconnect();
  receiver.disconnect();
});

// --------------------------------------------------------------------- M6

test("M6: writes to a deleted session never recreate it", async () => {
  // Calls the service layer directly, the way a handler would after its
  // access check passed but the session expired in between.
  process.env.REDIS_URL = REDIS_URL;
  process.env.LOG_LEVEL = "silent";
  const { connectRedis, redisClient } =
    await import("../dist/src/config/redis/index.js");
  const { changeTransferStatus, storeFileMetadata } =
    await import("../dist/src/config/redis/service.js");
  const { SessionStatus } = await import("../dist/src/config/redis/types.js");

  if (!redisClient.isOpen) await connectRedis();

  try {
    const ghost = `ghost-${Date.now()}`;

    const notFound = (error) => error?.statusCode === 404;

    await assert.rejects(
      changeTransferStatus(ghost, SessionStatus.COMPLETED),
      notFound,
      "a status write on a missing session must fail with 404",
    );
    assert.equal(
      await sessionExists(ghost),
      false,
      "status write resurrected it",
    );

    await assert.rejects(
      storeFileMetadata(ghost, "peer-ghost", {
        fileName: "a.txt",
        mimeType: "text/plain",
        fileSize: 1,
      }),
      notFound,
      "a metadata write on a missing session must fail with 404",
    );
    assert.equal(
      await sessionExists(ghost),
      false,
      "metadata write resurrected it",
    );
  } finally {
    await redisClient.quit();
  }
});
