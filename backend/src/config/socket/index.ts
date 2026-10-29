import { env } from "../env.js";
import { cleanupOnDisconnect, registerPeer } from "../redis/service.js";
import { handleWebRTC } from "../webrtc/index.js";
import { clearSessionExpiry, initSessionExpiry } from "./expiry.js";
import {
  CONNECTION_LIMIT_MESSAGE,
  getClientIp,
  isOverConnectionCap,
  releaseConnection,
  trackConnection,
} from "./rate-limit.js";
import { handleSessions } from "./session.js";
import type { ViaServer, ViaSocket } from "./types.js";
import { logSocket, registerSafeListener } from "./utils.js";

/**
 * How long a dropped connection may come back as the same socket (Socket.IO
 * connection state recovery). Shared with the server options in server.ts.
 */
export const RECOVERY_WINDOW_MS = env.recoveryWindowSeconds * 1000;

/**
 * Disconnect reasons Socket.IO can recover from. Socket.IO still fires
 * `disconnect` for these, so cleaning up straight away deleted the session
 * of a phone that was only switching networks.
 */
const RECOVERABLE_REASONS = new Set([
  "transport close",
  "transport error",
  "ping timeout",
]);

/** Cleanups waiting out the recovery window, keyed by socket id. */
const pendingCleanups = new Map<string, NodeJS.Timeout>();

const releasePeer = async (peerId: string): Promise<void> => {
  const result = await cleanupOnDisconnect(peerId);

  // Only a deleted session ends the expiry pushes: a member leaving
  // leaves the session (and its timer) running for the other peer.
  if (result.status === "deleted" && result.sessionId) {
    clearSessionExpiry(result.sessionId);
  }
};

export const initSocket = (io: ViaServer): void => {
  // The expiry scheduler needs the server so it can emit to session rooms.
  initSessionExpiry(io);

  // Refuse a client IP that already holds its share of sockets. Recovered
  // connections skip middleware, but are counted in the handler below.
  io.use((socket, next) => {
    const ip = getClientIp(socket);
    if (isOverConnectionCap(ip)) {
      logSocket("warn", "initSocket:[cap]", "CONNECTION CAP REACHED", { ip });
      next(new Error(CONNECTION_LIMIT_MESSAGE));
      return;
    }
    next();
  });

  io.on("connection", (socket: ViaSocket): void => {
    logSocket("info", "initSocket", "PEER CONNECTED", socket.id);

    const clientIp = getClientIp(socket);
    trackConnection(clientIp);
    socket.once("disconnect", () => releaseConnection(clientIp));

    // Listeners are registered synchronously: awaiting `registerPeer` first
    // let an event emitted right after `connect` arrive before its listener
    // existed, in which case the event was dropped without an ack.
    handleSessions(socket);
    handleWebRTC(socket);

    socket.on("error", (error: unknown) => {
      logSocket("error", "initSocket:[error]", "SOCKET ERROR", error);
    });

    // handle peer disconnect
    registerSafeListener(
      socket,
      "disconnect",
      "initSocket:[disconnect]",
      async (reason) => {
        logSocket("warn", "initSocket:[disconnect]", "PEER DISCONNECTED", {
          peerId: socket.id,
          reason,
        });

        if (typeof reason === "string" && RECOVERABLE_REASONS.has(reason)) {
          // Give the peer the recovery window to come back as this socket;
          // a reconnect cancels this in the connection handler.
          const timer = setTimeout(() => {
            pendingCleanups.delete(socket.id);
            void releasePeer(socket.id).catch((error: unknown) => {
              logSocket(
                "error",
                "initSocket:[disconnect]",
                "DEFERRED CLEANUP FAILED",
                error,
              );
            });
          }, RECOVERY_WINDOW_MS + 1_000);
          timer.unref();
          pendingCleanups.set(socket.id, timer);
          return;
        }

        await releasePeer(socket.id);
      },
    );

    if (socket.recovered) {
      // Same socket id, rooms restored: keep the session it already has.
      const pending = pendingCleanups.get(socket.id);
      if (pending) {
        clearTimeout(pending);
        pendingCleanups.delete(socket.id);
      }
      logSocket("info", "initSocket", "PEER RECOVERED", socket.id);
      return;
    }

    // handle peer registration
    void registerPeer(socket.id).catch((error: unknown) => {
      logSocket(
        "error",
        "initSocket:[registerPeer]",
        "UNABLE TO REGISTER NEW PEER",
        error,
      );
    });
  });
};
