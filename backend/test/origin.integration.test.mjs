// Origin checks when no CLIENT_ORIGIN allowlist is configured. Production must
// fail closed (same origin only), and a foreign page must not be able to open
// a WebSocket, which CORS headers alone would not stop.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io as ioClient } from "socket.io-client";
import { startTestServer, stopTestServer } from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_ORIGIN_PORT ?? 41741);

let baseUrl;
let server;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: { NODE_ENV: "production", CLIENT_ORIGIN: "" },
  }));
});

after(async () => {
  await stopTestServer(server);
});

const poll = (origin) =>
  fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: origin ? { Origin: origin } : {},
  });

test("production without an allowlist accepts the page's own origin", async () => {
  const sameOrigin = await poll(`http://127.0.0.1:${PORT}`);
  assert.equal(sameOrigin.status, 200);

  const noOrigin = await poll(null);
  assert.equal(noOrigin.status, 200, "requests without Origin still work");
});

test("production without an allowlist refuses a foreign origin", async () => {
  const foreign = await poll("http://evil.example");
  assert.equal(foreign.status, 403);
});

test("a foreign origin cannot open a WebSocket", async () => {
  const socket = ioClient(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: "http://evil.example" },
    reconnection: false,
    timeout: 3_000,
  });

  try {
    const outcome = await new Promise((resolve) => {
      socket.once("connect", () => resolve("connected"));
      socket.once("connect_error", () => resolve("refused"));
    });
    assert.equal(outcome, "refused");
  } finally {
    socket.close();
  }
});

test("the root banner route is gone", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 404);
});
