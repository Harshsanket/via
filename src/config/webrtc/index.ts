import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  changeTransferStatus,
  decreasePeersCount,
  isSessionExist,
} from "../redis/service.js";
import { SessionStatus } from "../../config/redis/types.js";

export function handleWebRTC(io: Server, socket: Socket): void {
  // WEBRTC OFFER
  socket.on("offer", async ({ sessionID, offer }) => {
    // check sessionID and offer
    if (!sessionID || typeof sessionID !== "string" || !offer) {
      return socket.emit("error", { message: "Offer invalid" });
    }

    // get session info
    try {
      const session = await isSessionExist(sessionID);
      if (!session)
        return socket.emit("error", { message: "Session expired or invalid" });
    } catch (error) {
      logger.error(`[REDIS] :: Error fetching session ${sessionID} :: WEB RTC`);
      logger.error(`[WEB RTC] :: ERROR GETTING SESSION :: ${sessionID}`);
      return socket.emit("error", { message: "Session expired or invalid" });
    }
    // fwd to peer
    socket.to(sessionID).emit("offer", { offer });
    logger.info(`[WEB RTC] :: OFFER FORWARDED TO SESSION :: ${sessionID}`);
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

  // transfer progress
  socket.on("transfer-complete", async ({ sessionID, fileName }) => {
    try {
      await changeTransferStatus(sessionID, SessionStatus.COMPLETED);
    } catch (error) {
      logger.error(
        `[REDIS] :: Error changing session status ${sessionID} :: WEB RTC`,
      );
    }

    logger.info(
      `[SOCKET] :: FILE :: [${fileName}] Transfer complete by session :: ${sessionID}`,
    );
    socket.to(sessionID).emit("transfer-complete", { fileName });
  });

  socket.on("transfer-error", async ({ sessionID, message }) => {
    try {
      await changeTransferStatus(sessionID, SessionStatus.ERROR);
    } catch (error) {
      logger.error(
        `[REDIS] :: Error changing session status ${sessionID} :: WEB RTC`,
      );
    }

    logger.warn(
      `[SOCKET] :: Transfer error occured by session :: ${sessionID} with  message :: ${message}`,
    );

    decreasePeersCount(sessionID);
    socket.to(sessionID).emit("error", { message });
  });

  // peer disconneted
  socket.on("disconnecting", async () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      try {
        await changeTransferStatus(roomId, SessionStatus.ERROR);
      } catch (error) {
        logger.error(
          `[REDIS] :: Error changing session status ${roomId} :: WEB RTC`,
        );
      }

      logger.warn(
        `[SOCKET] :: Peer :: ${socket.id} [DISCONNECTED] session :: ${roomId}`,
      );
      decreasePeersCount(roomId);
      socket.to(roomId).emit("peer-left");
    }
  });
}
