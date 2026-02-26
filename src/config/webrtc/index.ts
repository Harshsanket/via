import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  changeTransferStatus,
  decreasePeersCount,
  isSessionExist,
} from "../redis/service.js";
import { SessionStatus } from "../../config/redis/types.js";

export const handleWebRTC = (io: Server, socket: Socket): void => {
  // OFFER
  socket.on("offer", async ({ sessionId, offer }) => {
    // check sessionId and offer
    if (!sessionId || typeof sessionId !== "string" || !offer) {
      return socket.emit("error", { message: "Offer invalid" });
    }

    // get session info
    const session = await isSessionExist(sessionId);
    if (!session) {
      logger.error(`[WEB RTC] :: ERROR GETTING SESSION :: ${sessionId}`);
      return socket.emit("error", {
        message: "Session expired or invalid",
      });
    }

    // fwd to peer
    socket.to(sessionId).emit("offer", { offer });
    logger.info(`[WEB RTC] :: OFFER FORWARDED TO SESSION :: ${sessionId}`);
  });

  // ANSWER
  socket.on("answer", async ({ sessionId, answer }) => {
    const session = await isSessionExist(sessionId);
    if (!session) {
      logger.error(`[WEB RTC] :: ERROR GETTING SESSION :: ${sessionId}`);
      return socket.emit("error", {
        message: "Session expired or invalid",
      });
    }

    logger.info(`[SOCKET] :: ANSWER FORWARDED to session :: ${sessionId}`);
    socket.to(sessionId).emit("answer", { answer });
  });

  // ICE CANDIDATE
  socket.on("ice-candidate", async ({ sessionId, candidate }) => {
    const session = await isSessionExist(sessionId);
    if (!session) {
      logger.error(`[WEB RTC] :: ERROR GETTING SESSION :: ${sessionId}`);
      return socket.emit("error", {
        message: "Session expired or invalid",
      });
    }

    socket.to(sessionId).emit("ice-candidate", { candidate });
  });

  // completion
  socket.on("transfer-complete", async ({ sessionId, fileName }) => {
    try {
      await changeTransferStatus(sessionId, SessionStatus.COMPLETED);
    } catch (error) {
      logger.error(
        `[REDIS] :: Error changing session status ${sessionId} :: WEB RTC`,
      );
    }

    logger.info(
      `[SOCKET] :: FILE :: [${fileName}] Transfer complete by session :: ${sessionId}`,
    );
    socket.to(sessionId).emit("transfer-complete", { fileName });
  });

  // error
  socket.on("transfer-error", async ({ sessionId, message }) => {
    try {
      await changeTransferStatus(sessionId, SessionStatus.ERROR);
    } catch (error) {
      logger.error(
        `[REDIS] :: Error changing session status ${sessionId} :: WEB RTC`,
      );
    }

    logger.error(
      `[SOCKET] :: Transfer error occured by session :: ${sessionId} with  message :: ${message}`,
    );

    socket.to(sessionId).emit("error", { message });
  });

  // disconneting
  socket.on("disconnecting", async () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      try {
        await decreasePeersCount(roomId);
      } catch (error) {
        logger.error(
          `[REDIS] :: Error changing session status ${roomId} :: WEB RTC`,
        );
      }

      logger.warn(
        `[SOCKET] :: [DISCONNECTED]:: Peer :: ${socket.id} session :: ${roomId}`,
      );
      socket.to(roomId).emit("peer-left");
    }
  });
};
