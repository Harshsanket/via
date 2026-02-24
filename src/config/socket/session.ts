import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  createSession,
  joinSession,
  refreshSessionTTL,
} from "../redis/service.js";

export const handleSessions = (io: Server, socket: Socket) => {
  // create session
  socket.on("create-session", async (callback) => {
    // check callback
    if (typeof callback !== "function") return;

    try {
      // generate and store session
      const sessionId = crypto.randomUUID();
      await createSession(sessionId, socket.id);

      // join session
      socket.join(sessionId);

      logger.info(
        `[SOCKET] :: [SESSION] CREATED by peer :: ${socket.id} with SESSION_ID :: ${sessionId}`,
      );
      callback({
        success: true,
        sessionId,
        message: "session creation successful",
      });
    } catch (error) {
      callback({ success: false, message: "session creation failed" });
      logger.error(`[SESSION] :: ERROR WHILE CREATING SESSION :: ${error}`);
    }
  });

  // join session
  socket.on("join-session", async ({ sessionId }, callback) => {
    // check callback
    if (typeof callback !== "function") return;

    // join session
    try {
      await joinSession(sessionId);
      socket.join(sessionId);
      socket.to(sessionId).emit("peer-joined");

      await refreshSessionTTL(sessionId);

      logger.info(
        `[SOCKET] :: [SESSION] :: ${sessionId} JOINED by PEER :: ${socket.id}`,
      );
      callback({ success: true, message: "session joined sucessfully" });
    } catch (error) {
      callback({ success: false, message: "Maximum session limit reach" });
      logger.error(`[SESSION] :: ERROR WHILE JOINING SESSION :: ${error}`);
    }
  });
};
