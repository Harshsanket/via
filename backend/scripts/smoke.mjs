import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Session ids must look like the server's crypto.randomUUID() output, or the
// parsers reject them before the check under test is reached.
const SAMPLE_SESSION_ID = "00000000-0000-4000-8000-000000000000";

process.env.REDIS_URL = "redis://localhost:6379";
process.env.LOG_LEVEL = "silent";
// Never read a developer's backend/.env while checking defaults.
process.env.NODE_ENV = "test";

const root = process.cwd();
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));
process.on("uncaughtException", (error) => unhandled.push(error));

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(`${name} :: ${error.message}`);
    console.log(`FAIL  ${name} :: ${error.message}`);
  }
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 250));

const utils = await load("dist/src/config/socket/utils.js");
const sessionMod = await load("dist/src/config/socket/session.js");
const webrtcMod = await load("dist/src/config/webrtc/index.js");
const envMod = await load("dist/src/config/env.js");
const turnMod = await load("dist/src/config/turn/index.js");
const turnUtils = await load("dist/src/config/turn/utils.js");
const rateLimit = await load("dist/src/config/socket/rate-limit.js");

// ------------------------------------------------------- trusted proxies

check("trusted proxy matching: CIDRs, exact IPs and mapped IPv4", () => {
  const trusted = rateLimit.parseTrustedProxies("172.30.1.0/24, 10.0.0.5, ::1");
  assert.equal(rateLimit.isTrustedProxy("172.30.1.7", trusted), true);
  assert.equal(rateLimit.isTrustedProxy("::ffff:172.30.1.7", trusted), true);
  assert.equal(rateLimit.isTrustedProxy("172.30.2.7", trusted), false);
  assert.equal(rateLimit.isTrustedProxy("10.0.0.5", trusted), true);
  assert.equal(rateLimit.isTrustedProxy("10.0.0.6", trusted), false);
  assert.equal(rateLimit.isTrustedProxy("::1", trusted), true);
  assert.equal(rateLimit.isTrustedProxy("192.168.0.9", trusted), false);
  assert.deepEqual(rateLimit.parseTrustedProxies("nonsense, 1.2.3.4/40"), []);
});

// ---------------------------------------------------------------- parsers
check("parseSessionPayload rejects an undefined payload", () => {
  assert.throws(
    () => utils.parseSessionPayload(undefined),
    utils.InvalidPayloadError,
  );
});

check("parseJoinSessionPayload rejects an empty object", () => {
  assert.throws(
    () => utils.parseJoinSessionPayload({}),
    utils.InvalidPayloadError,
  );
});

check("ice candidate: null allowed, number rejected", () => {
  assert.equal(
    utils.parseIceCandidatePayload({
      sessionId: SAMPLE_SESSION_ID,
      candidate: null,
    }).candidate,
    null,
  );
  assert.throws(
    () =>
      utils.parseIceCandidatePayload({
        sessionId: SAMPLE_SESSION_ID,
        candidate: 42,
      }),
    utils.InvalidPayloadError,
  );
});

check("file metadata: no fixed size cap, invalid sizes rejected", () => {
  const huge = 50 * 1024 ** 3 + 1;
  assert.equal(
    utils.parseStoreFileMetadataPayload({
      sessionId: SAMPLE_SESSION_ID,
      fileName: "a",
      mimeType: "text/plain",
      fileSize: huge,
    }).fileSize,
    huge,
  );
  for (const fileSize of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        utils.parseStoreFileMetadataPayload({
          sessionId: SAMPLE_SESSION_ID,
          fileName: "a",
          mimeType: "text/plain",
          fileSize,
        }),
      utils.InvalidPayloadError,
    );
  }
});

check("offer without an sdp is rejected", () => {
  assert.throws(
    () =>
      utils.parseOfferPayload({
        sessionId: SAMPLE_SESSION_ID,
        offer: { type: "offer" },
      }),
    utils.InvalidPayloadError,
  );
});

// ------------------------------------------------------- fake socket harness
const makeSocket = () => {
  const listeners = new Map();
  const emitted = [];
  const socket = {
    id: "peer-1",
    rooms: new Set(["peer-1"]),
    emitted,
    listeners,
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return socket;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
      return socket;
    },
    join(room) {
      socket.rooms.add(room);
    },
    to(room) {
      return {
        emit: (event, payload) => emitted.push({ event, payload, to: room }),
      };
    },
  };
  return socket;
};

const fire = (socket, event, ...args) => {
  const handlers = socket.listeners.get(event) ?? [];
  if (handlers.length === 0) throw new Error(`no listener for "${event}"`);
  return handlers.map((handler) => handler(...args));
};

const events = [
  "create-session",
  "join-session",
  "get-ttl",
  "store-file-metadata",
  "get-file-metadata",
  "transfer-complete",
  "transfer-error",
  "offer",
  "answer",
  "ice-candidate",
];

const socket = makeSocket();
sessionMod.handleSessions(socket);
webrtcMod.handleWebRTC(socket);

check("every event has a listener registered", () => {
  for (const event of events) {
    assert.ok(
      (socket.listeners.get(event) ?? []).length > 0,
      `missing listener for ${event}`,
    );
  }
});

// The original crash: destructuring an absent payload threw inside the
// listener, which Socket.IO does not catch.
for (const event of events) {
  check(`"${event}" with no arguments does not throw`, () => {
    fire(socket, event);
  });
}

check("each malformed event was answered with session:error", () => {
  const errorEvents = socket.emitted.filter(
    (entry) => entry.event === "session:error",
  );
  assert.equal(
    errorEvents.length,
    events.length,
    `expected ${events.length} session:error emits, got ${errorEvents.length}`,
  );
  for (const entry of errorEvents) {
    assert.equal(entry.payload.success, false);
    assert.equal(typeof entry.payload.message, "string");
  }
});

check("create-session without an ack reports a missing callback", () => {
  assert.ok(
    socket.emitted.some(
      (entry) =>
        entry.event === "session:error" &&
        entry.payload.message === "missing acknowledgement callback",
    ),
  );
});

// ------------------------------------------------------------- ack plumbing
const socket2 = makeSocket();
sessionMod.handleSessions(socket2);
webrtcMod.handleWebRTC(socket2);

let joinAck = "not-called";
check("join-session with no payload does not throw", () => {
  fire(socket2, "join-session", (payload) => {
    joinAck = payload;
  });
});

await tick();

check("join-session acked a validation error", () => {
  assert.deepEqual(joinAck, { success: false, message: "session id invalid" });
});

let createAck = "not-called";
check("create-session with an ack does not throw", () => {
  fire(socket2, "create-session", (payload) => {
    createAck = payload;
  });
});

await tick();

check("create-session with Redis unavailable acked a fallback error", () => {
  assert.equal(createAck?.success, false);
  assert.equal(createAck?.message, "session creation failed");
});

let offerAck = "not-called";
check("offer with an invalid description does not throw", () => {
  fire(
    socket2,
    "offer",
    { sessionId: SAMPLE_SESSION_ID, offer: null },
    (payload) => {
      offerAck = payload;
    },
  );
});

await tick();

check("offer with an invalid description acked 'invalid offer'", () => {
  assert.deepEqual(offerAck, { success: false, message: "invalid offer" });
});

// ------------------------------------------------------------ turn credentials
// Vectors computed with `openssl dgst -hmac`, not with this implementation, so
// they pin the wire format rather than restating it.
check("the turn password matches the openssl hmac-sha1 vector", () => {
  assert.equal(
    turnMod.signTurnCredential(
      "1750000000:test-peer",
      "via-test-secret",
      "sha1",
    ),
    "spml5kqsdcd6uhUjr8dBikBIiqI=",
  );
});

check("the turn password matches the openssl hmac-sha256 vector", () => {
  assert.equal(
    turnMod.signTurnCredential(
      "1750000000:test-peer",
      "via-test-secret",
      "sha256",
    ),
    "NSUTPIwwCmiQffty78xz/D7/Pl0v1gkT7PDMt6xhZbs=",
  );
});

check("stun defaults to a public server and turn is unconfigured", () => {
  assert.deepEqual(envMod.env.stunUrls, ["stun:stun.l.google.com:19302"]);
  assert.equal(envMod.env.turnUrls.length, 0);
  assert.equal(turnMod.isTurnConfigured(), false);
});

check("minting without a relay fails instead of returning stun only", () => {
  const error = (() => {
    try {
      turnMod.mintIceServers();
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error instanceof Error, "expected mintIceServers to throw");
  assert.equal(error.statusCode, 503);
  assert.equal(error.message, "relay is not configured");
});

check("the secret is never described by its value", () => {
  const described = turnUtils.describeSecret("via-test-secret");
  assert.ok(!described.includes("via-test-secret"));
  assert.equal(described, "15 characters");
  assert.equal(turnUtils.describeSecret(""), "unset");
});

check("no unhandled rejections or uncaught exceptions", () => {
  assert.equal(
    unhandled.length,
    0,
    `saw ${unhandled.length}: ${unhandled
      .map((entry) => entry?.message ?? entry)
      .join(" | ")}`,
  );
});

console.log(
  failures.length === 0
    ? "\nALL SMOKE CHECKS PASSED"
    : `\n${failures.length} SMOKE CHECK(S) FAILED\n- ${failures.join("\n- ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
