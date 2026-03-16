import { Server, Socket } from "socket.io";
import { handleWebRTC } from "../webrtc/index.js";
import { handleSessions } from "./session.js";
import { cleanupOnDisconnect, registerPeer } from "../redis/service.js";
import { logSocket } from "./utils.js";

export const initSocket = (io: Server): void => {
  io.on("connection", async (socket: Socket): Promise<void> => {
    // handle peer registration
    try {
      await registerPeer(socket.id);
    } catch (error) {
      logSocket(
        "error",
        "initSocket:[registerPeer]",
        "UNABLE TO REGISTER NEW PEER",
        socket.id,
      );
    }

    // handle peer session
    handleSessions(io, socket);

    // handle peer web rtc
    handleWebRTC(io, socket);

    // handle peer disconnect
    socket.on("disconnect", async () => {
      logSocket(
        "warn",
        "initSocket:[disconnect]",
        "PEER DISCONNECTED",
        socket.id,
      );

      // cleanup
      try {
        await cleanupOnDisconnect(socket.id);
      } catch (error) {
        logSocket(
          "error",
          "initSocket:[disconnect]",
          "ERROR ON CLEANING PEER",
          error,
        );
      }
    });
  });
};
