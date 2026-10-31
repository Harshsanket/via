// Shared helpers for the integration tests. Not a test file itself, so the
// `test/*.test.mjs` glob does not pick it up.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io as ioClient } from "socket.io-client";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

/**
 * Boots the compiled server (dist/src/server.js) and waits until its health
 * endpoint reports both dependencies up, so tests never race the boot.
 */
export const startTestServer = async ({ port, env = {} }) => {
  const log = { text: "" };

  const server = spawn(process.execPath, ["dist/src/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PORT: String(port),
      REDIS_URL,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => (log.text += chunk));
  server.stderr.on("data", (chunk) => (log.text += chunk));
  server.on("exit", (code) => (log.text += `\n[server exited: ${code}]`));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let lastError = "no attempt made";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return { server, baseUrl, log };
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `server on port ${port} never became healthy (${lastError}).\n--- server log ---\n${log.text}`,
  );
};

export const stopTestServer = async (server) => {
  if (!server || server.exitCode !== null) return;

  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
};

/** Tracks clients so a test file can close them all in `after`. */
export const makeClientPool = (baseUrl) => {
  const sockets = [];

  return {
    sockets,
    connect: async () => {
      const socket = ioClient(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timed out connecting a client")),
          5_000,
        );
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("connect_error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      return socket;
    },
    closeAll: () => {
      for (const socket of sockets) socket.disconnect();
    },
  };
};

export const waitFor = (socket, event, timeout = 5_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      timeout,
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

export const emitAck = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ack for "${event}"`)),
      5_000,
    );
    const done = (response) => {
      clearTimeout(timer);
      resolve(response);
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });

export const createSessionWithCode = async (socket) => {
  const ack = await emitAck(socket, "create-session");
  assert.equal(ack?.success, true, `create-session failed: ${ack?.message}`);
  assert.equal(typeof ack.sessionId, "string");
  assert.match(ack.shortCode, /^[a-z0-9]{4,6}$/);
  return ack;
};

export const createSession = async (socket) => {
  const ack = await createSessionWithCode(socket);
  return ack.sessionId;
};

export const resolveSession = async (socket, shortCode) => {
  return emitAck(socket, "resolve-session", { shortCode });
};

export const waitForHealth = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  return { status: response.status, body: await response.json() };
};
