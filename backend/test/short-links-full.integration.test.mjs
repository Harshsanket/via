// Every possible four-digit code is in use: session creation must fail with a
// clear message instead of leaking a long link or hanging.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "redis";
import {
  emitAck,
  makeClientPool,
  startTestServer,
  stopTestServer,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_SHORT_LINK_FULL_PORT ?? 41737);
const REDIS_URL = "redis://127.0.0.1:6379/1";

let baseUrl;
let server;
let pool;
let redis;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: { REDIS_URL },
  }));
  pool = makeClientPool(baseUrl);

  redis = createClient({ url: REDIS_URL });
  await redis.connect();
  await redis.flushDb();

  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const members = Array.from({ length: 10_000 }, (_, index) => ({
    score: expiresAt,
    value: index.toString().padStart(4, "0"),
  }));
  await redis.zAdd("short:active", members);
  assert.equal(await redis.zCard("short:active"), 10_000);
});

after(async () => {
  pool?.closeAll();
  await redis?.flushDb();
  await redis?.quit();
  await stopTestServer(server);
});

test("create-session reports a full short-code space", async () => {
  const socket = await pool.connect();
  const ack = await emitAck(socket, "create-session");

  assert.equal(ack?.success, false);
  assert.equal(ack.message, "all short links are in use");

  socket.disconnect();
});
