// Size and format limits on client payloads. Before these, every string was
// bounded only by maxHttpBufferSize (100 kB), and was stored and logged.
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

const PORT = Number(process.env.TEST_LIMITS_PORT ?? 41771);

let baseUrl;
let server;
let pool;

before(async () => {
  ({ server, baseUrl } = await startTestServer({ port: PORT }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("session ids must be server-issued UUIDs", async () => {
  const socket = await pool.connect();

  for (const sessionId of ["x".repeat(5_000), "../../etc", "not-a-uuid"]) {
    const ack = await emitAck(socket, "join-session", { sessionId });
    assert.equal(ack?.success, false, `accepted ${sessionId.slice(0, 20)}`);
    assert.equal(ack.message, "session id invalid");
  }

  const ice = await fetch(`${baseUrl}/api/v1/ice-servers?sessionId=not-a-uuid`);
  assert.equal(ice.status, 400);

  socket.disconnect();
});

test("file names over 255 characters are refused", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const refused = await emitAck(sender, "store-file-metadata", {
    sessionId,
    fileName: `${"a".repeat(252)}.txt`,
    mimeType: "text/plain",
    fileSize: 10,
  });
  assert.equal(refused?.success, false);
  assert.equal(refused.message, "invalid file metadata");

  sender.disconnect();
});

test("file sizes above the old 50 GB cap are accepted", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "huge.bin",
    mimeType: "application/octet-stream",
    fileSize: 50 * 1024 ** 3 + 1,
  });
  assert.equal((await stored)?.metadata?.fileSize, 50 * 1024 ** 3 + 1);

  sender.disconnect();
});

test("an unusable MIME type is stored as application/octet-stream", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "photo.png",
    mimeType: `text/html;${"x".repeat(500)}`,
    fileSize: 10,
  });
  const payload = await stored;
  assert.equal(payload?.metadata?.mimeType, "application/octet-stream");

  sender.disconnect();
});

test("oversized SDP and ICE candidates are refused", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const offer = await emitAck(sender, "offer", {
    sessionId,
    offer: { type: "offer", sdp: "v=0\r\n" + "a".repeat(70_000) },
  });
  assert.equal(offer?.success, false);
  assert.equal(offer.message, "invalid offer");

  const badType = await emitAck(sender, "offer", {
    sessionId,
    offer: { type: "<script>", sdp: "v=0\r\n" },
  });
  assert.equal(badType?.success, false, "only real SDP types are relayed");

  const candidate = await emitAck(sender, "ice-candidate", {
    sessionId,
    candidate: { candidate: "candidate:" + "1".repeat(2_000) },
  });
  assert.equal(candidate?.success, false);
  assert.equal(candidate.message, "invalid ice candidate");

  sender.disconnect();
});

test("encrypted file details may be longer, but only as base64url", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const sealed = `enc.v1.${"A".repeat(1_500)}`;
  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: sealed,
    mimeType: "application/octet-stream",
    fileSize: 10,
  });
  assert.equal((await stored)?.metadata?.fileName, sealed);

  const other = await pool.connect();
  const otherSession = await createSession(other);
  for (const fileName of [
    `enc.v1.${"A".repeat(2_100)}`,
    `enc.v1.<b>${"A".repeat(300)}`,
  ]) {
    const refused = await emitAck(other, "store-file-metadata", {
      sessionId: otherSession,
      fileName,
      mimeType: "application/octet-stream",
      fileSize: 10,
    });
    assert.equal(refused?.success, false, `accepted ${fileName.slice(0, 12)}`);
  }

  sender.disconnect();
  other.disconnect();
});
