// Host-only admin API: login, forced credential change, settings persistence
// and dynamic short-link mode.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  createSessionWithCode,
  makeClientPool,
  resolveSession,
  startTestServer,
  stopTestServer,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_ADMIN_PORT ?? 41738);
const settingsPath = join(tmpdir(), `via-admin-${randomUUID()}.json`);

let baseUrl;
let server;
let pool;
let token;
let credentialsChanged = false;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: { SETTINGS_PATH: settingsPath },
  }));
  pool = makeClientPool(baseUrl);
});

after(async () => {
  pool?.closeAll();
  await stopTestServer(server);
  await unlink(settingsPath).catch(() => undefined);
});

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
};

const auth = (value) => ({ Authorization: `Bearer ${value}` });

test("the admin API rejects unauthenticated settings reads", async () => {
  const { status, body } = await request("/api/v1/admin/settings");
  assert.equal(status, 401);
  assert.equal(body.success, false);
});

test("the default admin signs in and must change the password", async () => {
  const { status, body } = await request("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });

  assert.equal(status, 200, body.message);
  assert.equal(body.data.mustChangePassword, true);
  token = body.data.token;

  const settings = await request("/api/v1/admin/settings", {
    headers: auth(token),
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.data.shortLinks.mode, "numeric");
  assert.equal(settings.body.data.shortLinks.length, 4);

  const save = await request("/api/v1/admin/settings", {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ shortLinks: { mode: "alphanumeric", length: 6 } }),
  });
  assert.equal(save.status, 403);
  assert.match(save.body.message, /default admin password/i);
});

test("changing credentials invalidates the old token", async () => {
  const changed = await request("/api/v1/admin/credentials", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      currentPassword: "admin",
      username: "owner",
      newPassword: "new-password-123",
    }),
  });

  assert.equal(changed.status, 200, changed.body.message);
  assert.equal(changed.body.data.mustChangePassword, false);
  credentialsChanged = true;

  const oldToken = await request("/api/v1/admin/settings", {
    headers: auth(token),
  });
  assert.equal(oldToken.status, 401);

  token = changed.body.data.token;
  const newToken = await request("/api/v1/admin/settings", {
    headers: auth(token),
  });
  assert.equal(newToken.status, 200);
  assert.equal(newToken.body.data.admin.username, "owner");
  assert.equal(newToken.body.data.admin.mustChangePassword, false);

  const oldLogin = await request("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await request("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "owner", password: "new-password-123" }),
  });
  assert.equal(newLogin.status, 200, newLogin.body.message);
});

test("invalid settings are rejected", async () => {
  const invalidMode = await request("/api/v1/admin/settings", {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ shortLinks: { mode: "uppercase", length: 4 } }),
  });
  assert.equal(invalidMode.status, 400);

  const invalidUrl = await request("/api/v1/admin/settings", {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({
      network: { stunUrls: ["https://not-stun.example"] },
    }),
  });
  assert.equal(invalidUrl.status, 400);
});

test("dynamic short-link mode is persisted and used for new sessions", async () => {
  const save = await request("/api/v1/admin/settings", {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({
      shortLinks: { mode: "alphanumeric", length: 6 },
      sessions: { ttlSeconds: 45 },
    }),
  });

  assert.equal(save.status, 200, save.body.message);
  assert.deepEqual(save.body.data.shortLinks, {
    mode: "alphanumeric",
    length: 6,
  });
  assert.equal(save.body.data.sessions.ttlSeconds, 45);

  const stored = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(stored.shortLinks, { mode: "alphanumeric", length: 6 });
  assert.equal(stored.sessions.ttlSeconds, 45);

  const socket = await pool.connect();
  const receiver = await pool.connect();
  const { sessionId, shortCode } = await createSessionWithCode(socket);
  assert.match(shortCode, /^[a-z0-9]{6}$/);

  const resolved = await resolveSession(receiver, shortCode);
  assert.equal(resolved?.success, true, resolved?.message);
  assert.equal(resolved.sessionId, sessionId);

  socket.disconnect();
  receiver.disconnect();
});

test("the general settings endpoint cannot change admin credentials", async () => {
  const attempt = await request("/api/v1/admin/settings", {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({
      admin: { username: "attacker", mustChangePassword: false },
    }),
  });
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.data.admin.username, "owner");

  const login = await request("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "owner", password: "new-password-123" }),
  });
  assert.equal(login.status, 200);
});

test("a failed credentials change keeps the old login", async () => {
  assert.equal(credentialsChanged, true);
  const failed = await request("/api/v1/admin/credentials", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      currentPassword: "wrong",
      username: "nobody",
      newPassword: "another-password",
    }),
  });
  assert.equal(failed.status, 403);

  const stillWorks = await request("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: "owner", password: "new-password-123" }),
  });
  assert.equal(stillWorks.status, 200);
});
