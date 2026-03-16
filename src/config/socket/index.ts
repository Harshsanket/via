import { Server, Socket } from "socket.io";
import { handleWebRTC } from "../webrtc/index.js";
<<<<<<< HEAD
import { logger } from "../../utils/logger.js";
import { handleSessions } from "./session.js";
import { cleanupOnDisconnect, registerPeer } from "../redis/service.js";

export const initSocket = (io: Server): void => {
  io.on("connection", async (socket: Socket): Promise<void> => {
    try {
      await registerPeer(socket.id);
    } catch (error) {
      logger.error(`[SOCKET] :: [ERROR] :: [PEER] :: ${socket.id}`);
    }

    // session
    handleSessions(io, socket);

    // web rtc
    handleWebRTC(io, socket);

    socket.on("disconnect", async () => {
      logger.warn(
        `[SOCKET] :: [DISCONNECTED] CONNECTION by peer :: ${socket.id}`,
=======
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
>>>>>>> main
      );

      // cleanup
      try {
        await cleanupOnDisconnect(socket.id);
      } catch (error) {
<<<<<<< HEAD
        logger.error(
          `[SESSION] :: [cleanupOnDisconnect] :: ERROR ON CLEANING UP :: ${error}`,
=======
        logSocket(
          "error",
          "initSocket:[disconnect]",
          "ERROR ON CLEANING PEER",
          error,
>>>>>>> main
        );
      }
    });
  });
};
