// Short receive links: allocation, resolution, TTL sync and release.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "redis";
import {
  createSessionWithCode,
  emitAck,
  makeClientPool,
  resolveSession,
  startTestServer,
  stopTestServer,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_SHORT_LINK_PORT ?? 41736);
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const SESSION_TTL_SECONDS = 30;
const REFRESH_TTL_SECONDS = 120;

let baseUrl;
let server;
let pool;
let redis;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: {
      SESSION_TTL_SECONDS: String(SESSION_TTL_SECONDS),
      REFRESH_SESSION_TTL_SECONDS: String(REFRESH_TTL_SECONDS),
      SESSION_MAX_LIFETIME_SECONDS: "600",
      SESSION_EXPIRY_WARNING_SECONDS: "0",
    },
  }));
  pool = makeClientPool(baseUrl);

  redis = createClient({ url: REDIS_URL });
  await redis.connect();
});

after(async () => {
  pool?.closeAll();
  await redis?.quit();
  await stopTestServer(server);
});

const shortKey = (code) => `short:${code}`;

test("create-session allocates a four-digit code backed by Redis", async () => {
  const sender = await pool.connect();
  const { sessionId, shortCode } = await createSessionWithCode(sender);

  assert.match(shortCode, /^[0-9]{4}$/);
  assert.equal(await redis.get(shortKey(shortCode)), sessionId);
  assert.ok((await redis.ttl(shortKey(shortCode))) > 0);
  assert.notEqual(await redis.zScore("short:active", shortCode), null);

  sender.disconnect();
});

test("resolve-session returns the UUID and rejects unknown codes", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const { sessionId, shortCode } = await createSessionWithCode(sender);

  const resolved = await resolveSession(receiver, shortCode);
  assert.equal(resolved?.success, true, resolved?.message);
  assert.equal(resolved.sessionId, sessionId);

  const missing = await resolveSession(receiver, "zzzz");
  assert.equal(missing?.success, false);
  assert.equal(missing.message, "session expired or invalid");

  sender.disconnect();
  receiver.disconnect();
});

test("joining extends the alias TTL to the refreshed session TTL", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const { sessionId, shortCode } = await createSessionWithCode(sender);

  const beforeJoin = await redis.ttl(shortKey(shortCode));
  assert.ok(
    beforeJoin > 0 && beforeJoin <= SESSION_TTL_SECONDS,
    `unexpected initial TTL ${beforeJoin}`,
  );

  const join = await emitAck(receiver, "join-session", { sessionId });
  assert.equal(join?.success, true, join?.message);

  const afterJoin = await redis.ttl(shortKey(shortCode));
  assert.ok(
    afterJoin > SESSION_TTL_SECONDS && afterJoin <= REFRESH_TTL_SECONDS,
    `unexpected refreshed TTL ${afterJoin}`,
  );

  sender.disconnect();
  receiver.disconnect();
});

test("completion releases the code immediately for reuse", async () => {
  const sender = await pool.connect();
  const receiver = await pool.connect();
  const { sessionId, shortCode } = await createSessionWithCode(sender);

  assert.equal(await redis.get(shortKey(shortCode)), sessionId);
  await emitAck(receiver, "join-session", { sessionId });

  const completed = await emitAck(receiver, "transfer-complete", {
    sessionId,
    fileName: "done.bin",
  });
  assert.equal(completed?.success, true, completed?.message);

  assert.equal(await redis.get(shortKey(shortCode)), null);
  assert.equal(await redis.zScore("short:active", shortCode), null);
  assert.equal((await resolveSession(receiver, shortCode))?.success, false);

  sender.disconnect();
  receiver.disconnect();
});

test("creator disconnect releases the code", async () => {
  const sender = await pool.connect();
  const { shortCode } = await createSessionWithCode(sender);

  assert.equal((await redis.get(shortKey(shortCode))) !== null, true);
  sender.disconnect();

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await redis.get(shortKey(shortCode))) === null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(await redis.get(shortKey(shortCode)), null);
  assert.equal(await redis.zScore("short:active", shortCode), null);
});

test("a freed code can be reused without a late cleanup removing it", async () => {
  process.env.REDIS_URL = REDIS_URL;
  process.env.LOG_LEVEL = "silent";
  const { connectRedis, redisClient } =
    await import("../dist/src/config/redis/index.js");
  const { runReleaseShortCodeScript, runReserveShortCodeScript } =
    await import("../dist/src/config/redis/scripts.js");

  if (!redisClient.isOpen) await connectRedis();

  const code = "zz99";
  const params = { code, ttlSeconds: 60, capacity: 10_000 };

  try {
    await redisClient.set("session:old", "placeholder", { EX: 60 });
    await runReleaseShortCodeScript({ code, sessionId: "old" });
    assert.equal(
      await runReserveShortCodeScript({ ...params, sessionId: "old" }),
      "ok",
      "the code must be free before the test starts",
    );
    assert.equal(
      await runReserveShortCodeScript({ ...params, sessionId: "new" }),
      "collision",
      "a live code cannot be reserved twice",
    );

    // A late cleanup from the old owner must not delete the new owner's code.
    await runReleaseShortCodeScript({ code, sessionId: "ghost" });
    assert.equal(await redisClient.get(shortKey(code)), "old");

    await runReleaseShortCodeScript({ code, sessionId: "old" });
    assert.equal(
      await runReserveShortCodeScript({ ...params, sessionId: "new" }),
      "ok",
      "the freed code must be reusable",
    );
  } finally {
    await runReleaseShortCodeScript({ code, sessionId: "new" });
    await redisClient.del("session:old");
    await redisClient.quit();
  }
});
