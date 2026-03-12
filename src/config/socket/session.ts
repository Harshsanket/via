import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  createSession,
  joinSession,
  refreshSessionTTL,
} from "../redis/service.js";

export const handleSessions = (io: Server, socket: Socket): void => {
  // create session
  socket.on("create-session", async (callback) => {
    // check callback
    if (typeof callback !== "function") return;

    try {
      // generate and store session
      const sessionId = crypto.randomUUID();
      const createSessionParam = {
        sessionId,
        peerId: socket.id,
      };
      await createSession(createSessionParam);

      // join session
      socket.join(sessionId);

      logger.info(
        `[SOCKET] :: [SESSION] CREATED by peer :: ${socket.id} with SESSION_ID :: ${sessionId}`,
      );
      callback({
        success: true,
        sessionId,
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
      const joinSessionParam = {
        sessionId,
        peerId: socket.id,
      };
      await joinSession(joinSessionParam);
      socket.join(sessionId);
      socket.to(sessionId).emit("peer-joined");

      // change it for user- bug here [fixed] // used createdBy to refresh ttl
      await refreshSessionTTL(sessionId);

      logger.info(
        `[SOCKET] :: [SESSION] :: ${sessionId} JOINED by PEER :: ${socket.id}`,
      );
      callback({ success: true });
    } catch (error) {
      callback({ success: false, message: "Maximum session limit reach" });
      logger.error(`[SESSION] :: ERROR WHILE JOINING SESSION :: ${error}`);
    }
  });
};
