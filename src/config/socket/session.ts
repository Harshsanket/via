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
      const sessionID = crypto.randomUUID();
      await createSession(sessionID, socket.id);

      // join session
      socket.join(sessionID);

      logger.info(
        `[SOCKET] :: [SESSION] CREATED by peer :: ${socket.id} with SESSION_ID :: ${sessionID}`,
      );
      callback({ sessionID });
    } catch (error) {
      logger.error(`[SESSION] :: ERROR WHILE CREATING SESSION :: ${error}`);
    }
  });

  // join session
  socket.on("join-session", async ({ sessionID }, callback) => {
    // check callback
    if (typeof callback !== "function") return;

    const tryJoinnigSession = joinSession(sessionID);
    if (!tryJoinnigSession)
      callback({ success: false, message: "Maximum session limit reach" });

    // join session
    try {
      socket.join(sessionID);
      socket.to(sessionID).emit("peer-joined");

      await refreshSessionTTL(sessionID);

      logger.info(
        `[SOCKET] :: [SESSION] :: ${sessionID} JOINED by PEER :: ${socket.id}`,
      );
      callback({ success: true });
    } catch (error) {
      logger.error(`[SESSION] :: ERROR WHILE JOINING SESSION :: ${error}`);
    }
  });
};
