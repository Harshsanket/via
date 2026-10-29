// MAX_FILE_SIZE_BYTES is optional: 0 (the default) means no cap, any positive
// value rejects larger announcements before they reach Redis.
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

const PORT = Number(process.env.TEST_FILE_SIZE_PORT ?? 41772);
const MAX_FILE_SIZE_BYTES = 100;

let baseUrl;
let server;
let pool;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: { MAX_FILE_SIZE_BYTES: String(MAX_FILE_SIZE_BYTES) },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
});

test("MAX_FILE_SIZE_BYTES caps announced sizes when set", async () => {
  const sender = await pool.connect();
  const sessionId = await createSession(sender);

  const refused = await emitAck(sender, "store-file-metadata", {
    sessionId,
    fileName: "too-big.bin",
    mimeType: "application/octet-stream",
    fileSize: MAX_FILE_SIZE_BYTES + 1,
  });
  assert.equal(refused?.success, false);
  assert.equal(refused.message, "invalid file metadata");

  const stored = waitFor(sender, "file-metadata");
  sender.emit("store-file-metadata", {
    sessionId,
    fileName: "just-right.bin",
    mimeType: "application/octet-stream",
    fileSize: MAX_FILE_SIZE_BYTES,
  });
  assert.equal((await stored)?.metadata?.fileSize, MAX_FILE_SIZE_BYTES);

  sender.disconnect();
});
