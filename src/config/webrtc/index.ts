import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import { redisClient } from "../redis/index.js";
import { isSessionIdValid } from "../socket/validators.js";
import { deleteSession } from "../redis/service.js";

export function handleWebRTC(io: Server, socket: Socket): void {
  // WEBRTC OFFER
  socket.on("offer", async ({ sessionID, offer }) => {
    // check sessionID
    if (!isSessionIdValid(sessionID) || !offer) {
      return socket.emit("error", { message: "Offer invalid" });
    }

    // get session from redis
    const getSession = await redisClient.hGetAll(`session:${sessionID}`);
    if (!getSession) {
      logger.error(`[REDIS] :: Error fetching session ${sessionID}`);
      return socket.emit("error", { message: "Session expired or invalid" });
    }

    // fwd to peer
    socket.to(sessionID).emit("offer", { offer });
    logger.info(`[SOCKET] :: OFFER FORWARDED to session :: ${sessionID}`);
  });

  // WEBRTC ANSWER
  socket.on("answer", ({ sessionID, answer }) => {
    logger.info(`[SOCKET] :: ANSWER FORWARDED to session :: ${sessionID}`);
    socket.to(sessionID).emit("answer", { answer });
  });

  // ICE CANDIDATE
  socket.on("ice-candidate", ({ sessionID, candidate }) => {
    socket.to(sessionID).emit("ice-candidate", { candidate });
  });

  socket.on("transfer-complete", ({ sessionID, fileName }) => {
    logger.info(
      `[SOCKET] :: FILE :: [${fileName}] Transfer complete by session :: ${sessionID}`,
    );
    socket.to(sessionID).emit("transfer-complete", { fileName });
    deleteSession(sessionID);
  });

  socket.on("transfer-error", ({ sessionID, message }) => {
    logger.warn(
      `[SOCKET] :: Transfer error occured by session :: ${sessionID} with  message :: ${message}`,
    );

    socket.to(sessionID).emit("error", { message });
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      logger.warn(
        `[SOCKET] :: Peer :: ${socket.id} [DISCONNECTED] session :: ${roomId}`,
      );

      socket.to(roomId).emit("peer-left");
    }
  });
}
