import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import { createSession, isSessionExist } from "../redis/service.js";

export const handleSessions = (io: Server, socket: Socket) => {

  // create session
  socket.on("create-session", async (callback) => {
    if (typeof callback !== "function") return;

    // generate and store session
    const sessionID = crypto.randomUUID();
    await createSession(sessionID, socket.id);

    // join session
    socket.join(sessionID);

    logger.info(
      `[SOCKET] :: [SESSION] CREATED by peer :: ${socket.id} with SESSION_ID :: ${sessionID}`,
    );
    callback({ sessionID });
  });

  // join session
  socket.on("join-session", async ({ sessionID }, callback) => {
    
    // check callback
    if (typeof callback !== "function") return;
    const room = io.sockets.adapter.rooms.get(sessionID);

    // check room
    if (!room) {
      return callback({ error: "Session does not exist" });
    }

    // check room size
    if (room.size >= 2) {
      return callback({ error: "Room is full" });
    }

    // check session
    const session = await isSessionExist(sessionID);
    if (!session) return callback({ error: "Session does not seem to exist" });

    // join session
    socket.join(sessionID);
    socket.to(sessionID).emit("peer-joined");

    logger.info(
      `[SOCKET] :: [SESSION] :: ${sessionID} JOINED by PEER :: ${socket.id}`,
    );

    callback({ success: true });
  });
};
