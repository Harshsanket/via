import { Server, Socket } from "socket.io";
import { handleWebRTC } from "../webrtc/index.js";
import { logger } from "../../utils/logger.js";
import { handleSessions } from "./session.js";
import { cleanupOnDisconnect } from "../redis/service.js";

export const initSocket = (io: Server): void => {
  io.on("connection", (socket: Socket): void => {
    logger.info(`[SOCKET] :: [CONNECTED] peer :: ${socket.id}`);

    // session
    handleSessions(io, socket);

    // web rtc
    handleWebRTC(io, socket);

    socket.on("disconnect", async () => {
      logger.warn(
        `[SOCKET] :: [DISCONNECTED] CONNECTION by peer :: ${socket.id}`,
      );

      // cleanup
      await cleanupOnDisconnect(socket.id);
    });
  });
};
