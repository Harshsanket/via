import { cleanupOnDisconnect, registerPeer } from "../redis/service.js";
import { handleWebRTC } from "../webrtc/index.js";
import { clearSessionExpiry, initSessionExpiry } from "./expiry.js";
import { handleSessions } from "./session.js";
import type { ViaServer, ViaSocket } from "./types.js";
import { logSocket, registerSafeListener } from "./utils.js";

export const initSocket = (io: ViaServer): void => {
  // The expiry scheduler needs the server so it can emit to session rooms.
  initSessionExpiry(io);

  io.on("connection", (socket: ViaSocket): void => {
    logSocket("info", "initSocket", "PEER CONNECTED", socket.id);

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
      async () => {
        logSocket(
          "warn",
          "initSocket:[disconnect]",
          "PEER DISCONNECTED",
          socket.id,
        );

        const result = await cleanupOnDisconnect(socket.id);

        // Only a deleted session ends the expiry pushes: a member leaving
        // leaves the session (and its timer) running for the other peer.
        if (result.status === "deleted" && result.sessionId) {
          clearSessionExpiry(result.sessionId);
        }
      },
    );

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
