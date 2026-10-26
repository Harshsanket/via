// Abuse limits: per-socket event budgets, disconnecting persistent flooders,
// and a cap on concurrent sockets per client IP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { io as ioClient } from "socket.io-client";
import {
  createSession,
  emitAck,
  startTestServer,
  stopTestServer,
  waitFor,
} from "./socket-test-helpers.mjs";

const PORT = Number(process.env.TEST_RATE_PORT ?? 41781);
const MAX_SOCKETS_PER_IP = 3;

let baseUrl;
let server;

before(async () => {
  ({ server, baseUrl } = await startTestServer({
    port: PORT,
    env: { MAX_SOCKETS_PER_IP: String(MAX_SOCKETS_PER_IP) },
  }));
});

after(async () => {
  await stopTestServer(server);
});

/** Connects one client; resolves to the socket or to the connect error. */
const connect = (headers = {}) =>
  new Promise((resolve) => {
    const socket = ioClient(baseUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      extraHeaders: headers,
    });
    socket.once("connect", () => resolve({ socket }));
    socket.once("connect_error", (error) => {
      socket.close();
      resolve({ error });
    });
  });

const connectOk = async (headers) => {
  const { socket, error } = await connect(headers);
  assert.ok(socket, `connect failed: ${error?.message}`);
  return socket;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("create-session floods are throttled", async () => {
  const socket = await connectOk();

  const acks = [];
  for (let i = 0; i < 10; i += 1) {
    acks.push(await emitAck(socket, "create-session"));
  }

  const limited = acks.filter((ack) => ack?.message === "too many requests");
  assert.ok(limited.length >= 5, `only ${limited.length} of 10 were limited`);
  assert.equal(acks[0]?.success, true, "the first create must succeed");

  socket.disconnect();
  await settle();
});

test("ICE candidate floods are throttled", async () => {
  const socket = await connectOk();
  const sessionId = await createSession(socket);

  const errors = [];
  socket.on("session:error", (payload) => errors.push(payload?.message));

  for (let i = 0; i < 150; i += 1) {
    socket.emit("ice-candidate", {
      sessionId,
      candidate: { candidate: `candidate:${i} 1 udp 1 10.0.0.1 9 typ host` },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.ok(
    errors.includes("too many requests"),
    `no throttling after 150 candidates (errors: ${errors.length})`,
  );
  assert.equal(socket.connected, true, "a short burst must not disconnect");

  socket.disconnect();
  await settle();
});

test("a socket that keeps flooding is disconnected", async () => {
  const socket = await connectOk();
  const sessionId = await createSession(socket);
  const kicked = waitFor(socket, "disconnect", 5_000);

  for (let i = 0; i < 1_000; i += 1) {
    socket.emit("ice-candidate", {
      sessionId,
      candidate: { candidate: `candidate:${i} 1 udp 1 10.0.0.1 9 typ host` },
    });
  }

  assert.equal(await kicked, "io server disconnect");
  await settle();
});

test("one client IP cannot hold more than the socket cap", async () => {
  const held = [];
  for (let i = 0; i < MAX_SOCKETS_PER_IP; i += 1) held.push(await connectOk());

  const extra = await connect();
  assert.ok(extra.error, "a socket over the cap must be refused");
  assert.equal(extra.error.message, "too many connections");

  // Closing one frees a slot.
  held.pop().disconnect();
  await settle();
  held.push(await connectOk());

  for (const socket of held) socket.disconnect();
  await settle();
});

test("the cap follows the client IP that the local proxy reports", async () => {
  // Requests from loopback are nginx forwarding for a client; X-Real-IP
  // carries that client's address.
  const fromA = [];
  for (let i = 0; i < MAX_SOCKETS_PER_IP; i += 1) {
    fromA.push(await connectOk({ "x-real-ip": "192.168.0.10" }));
  }

  const moreFromA = await connect({ "x-real-ip": "192.168.0.10" });
  assert.ok(moreFromA.error, "client A is over its cap");

  const fromB = await connectOk({ "x-real-ip": "192.168.0.11" });

  for (const socket of [...fromA, fromB]) socket.disconnect();
  await settle();
});
