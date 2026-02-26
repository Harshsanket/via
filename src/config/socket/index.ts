import { Server, Socket } from "socket.io";
import { handleWebRTC } from "../webrtc/index.js";
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
      );

      // cleanup
      try {
        await cleanupOnDisconnect(socket.id);
      } catch (error) {
        logger.error(
          `[SESSION] :: [cleanupOnDisconnect] :: ERROR ON CLEANING UP :: ${error}`,
        );
      }
    });
  });
};
