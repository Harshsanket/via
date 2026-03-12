import { Server, Socket } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  changeTransferStatus,
  decreasePeersCount,
  getFileMetadata,
  getSessionTTL,
  isSessionExist,
  storeFileMetadata,
} from "../redis/service.js";
import { SessionStatus } from "../../config/redis/types.js";
import {
  OfferPayload,
  AnswerPayload,
  IceCandidatePayload,
  FileMetadataPayload,
  TransferCompletePayload,
  TransferErrorPayload,
} from "./types.js";

export const handleWebRTC = (io: Server, socket: Socket): void => {
  // OFFER
  socket.on(
    "offer",
    async ({ sessionId, offer }: OfferPayload): Promise<void> => {
      try {
        if (!sessionId || typeof sessionId !== "string" || !offer) {
          logger.error(
            `[WEB RTC] :: [SOCKET:OFFER] :: SESSION OR INAVLID OFFER`,
          );
          socket.emit("error", { message: "Offer invalid" });
          return;
        }

        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [OFFER] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:OFFER] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        socket.to(sessionId).emit("offer", { offer });

        logger.info(
          `[WEB RTC] :: [OFFER FORWARDED] TO SESSION :: ${sessionId}`,
        );
      } catch (err: unknown) {
        logger.error(
          `[WEB RTC] :: [OFFER HANDLER FAILED] for Session :: ${sessionId} with Error :: ${err}`,
        );
        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

  // ANSWER
  socket.on(
    "answer",
    async ({ sessionId, answer }: AnswerPayload): Promise<void> => {
      try {
        if (!sessionId || typeof sessionId !== "string" || !answer) {
          logger.error(
            `[WEB RTC] :: [SOCKET:ANSWER] :: SESSION OR INAVLID ANSWER`,
          );
          socket.emit("error", { message: "Answer invalid" });
          return;
        }

        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [ANSWER] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:ANSWER] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        socket.to(sessionId).emit("answer", { answer });

        logger.info(
          `[WEB RTC] :: [ANSWER FORWARDED] TO SESSION :: ${sessionId}`,
        );
      } catch (err: unknown) {
        logger.error(
          `[WEB RTC] :: [ANSWER HANDLER] FAILED for session :: ${sessionId} with Error :: ${err}`,
        );

        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

  // ICE CANDIDATE
  socket.on(
    "ice-candidate",
    async ({ sessionId, candidate }: IceCandidatePayload): Promise<void> => {
      try {
        if (!sessionId || typeof sessionId !== "string" || !candidate) {
          logger.error(
            `[WEB RTC] :: [SOCKET:ICE_CANDIDATE] :: SESSION OR INAVLID ICE CANDIDATE`,
          );
          socket.emit("error", { message: "ICE candidate invalid" });
          return;
        }

        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [SOCKET:ICE_CANDIDATE] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:ICE_CANDIDATE] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Unauthorized session access",
          });
          return;
        }

        socket.to(sessionId).emit("ice-candidate", { candidate });

        logger.info(
          `[WEB RTC] :: [ICE CANDIDATE] FORWARDED TO SESSION :: ${sessionId}`,
        );
      } catch (err: unknown) {
        logger.error(
          `[WEB RTC] :: [ICE HANDLER] FAILED for session :: ${sessionId} with Error :: ${err}`,
        );

        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

  // store Metadata
  socket.on(
    "file-metadata",
    async ({ sessionId, metadata }: FileMetadataPayload): Promise<void> => {
      const MAX_FILE_SIZE: number = 50 * 1024 * 1024 * 1024;

      if (!sessionId || typeof sessionId !== "string") {
        logger.error(
          `[WEB RTC] :: [SOCKET:FILE_METADATA] :: SESSION OR INAVLID FILE METADATA`,
        );
        socket.emit("error", { message: "Invalid sessionId" });
        return;
      }

      if (
        !metadata ||
        typeof metadata.fileName !== "string" ||
        typeof metadata.mimeType !== "string" ||
        typeof metadata.fileSize !== "number"
      ) {
        socket.emit("error", { message: "Invalid file metadata" });
        return;
      }

      if (metadata.fileSize <= 0 || metadata.fileSize > MAX_FILE_SIZE) {
        socket.emit("error", { message: "Invalid file size" });
        return;
      }

      const { fileName, mimeType, fileSize } = metadata;

      try {
        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [SOCKET:FILE_METADATA] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:FILE_METADATA] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        await storeFileMetadata(sessionId, {
          fileName,
          mimeType,
          fileSize,
        });

        socket.emit("file-metadata-received", {
          sessionId,
          fileName,
          success: true,
        });

        logger.info(
          `[SOCKET] :: [FILE METADATA] Received for Session: ${sessionId}`,
        );
      } catch (err: unknown) {
        logger.error(
          `[SOCKET] :: [FILE METADATA] :: HANDLER FAILED for session ${sessionId} with Error :: ${err}`,
        );

        socket.emit("file-metadata-received", {
          sessionId,
          success: false,
          error: "Failed sharing metadata",
        });
      }
    },
  );

  socket.on("get-file-metadata", async ({ sessionId, peerId }) => {
    if (!sessionId || typeof sessionId !== "string") {
      logger.error(`[WEBRTC] :: [get-file-metadata] :: SESSION INVALID`);
      socket.emit("error", { message: "Invalid sessionId" });
      return;
    }

    if (!peerId || typeof peerId !== "string") {
      logger.error(`[WEBRTC] :: [get-file-metadata] :: PEER INVALID`);
      socket.emit("error", { message: "Invalid peerId" });
      return;
    }

    try {
      logger.info(
        `[WEBRTC] :: [get-file-metadata] :: REQUEST FROM ${peerId} FOR SESSION ${sessionId}`,
      );

      const metadata = await getFileMetadata(sessionId);

      socket.emit("file-metadata", {
        success: true,
        sessionId,
        peerId,
        metadata,
      });

      logger.info(
        `[WEBRTC] :: [get-file-metadata] :: METADATA SENT TO ${peerId}`,
      );
    } catch (error) {
      logger.error(`[WEBRTC] :: [get-file-metadata] :: ERROR :: ${error}`);

      socket.emit("file-metadata", {
        success: false,
        message: "Metadata not found",
      });
    }
  });

  // ttl
  socket.once("get-ttl", async ({ sessionId, peerId }) => {
    if (!sessionId || typeof sessionId !== "string") {
      logger.error(`[WEB RTC] :: [get-ttl] :: SESSION INAVLID`);
      socket.emit("error", { message: "Invalid sessionId" });
      return;
    }

    if (!peerId || typeof peerId !== "string") {
      logger.error(`[WEB RTC] :: [get-ttl] :: PEER ID INVALID`);
      socket.emit("error", { message: "Invalid peerid" });
      return;
    }

    try {
      const result = await getSessionTTL(sessionId, peerId);

      socket.emit("session-ttl", result);
    } catch (error) {
      logger.error(`[SOCKET] [getSessionTTL] ${error}`);

      socket.emit("session:error", {
        message: "Failed to fetch session TTL",
      });
    }
  });

  // completion
  socket.once(
    "transfer-complete",
    async ({ sessionId, fileName }: TransferCompletePayload): Promise<void> => {
      try {
        if (
          !sessionId ||
          typeof sessionId !== "string" ||
          !fileName ||
          typeof fileName !== "string"
        ) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_COMPLETE] :: SESSION OR INAVLID FILE NAME`,
          );
          socket.emit("error", {
            message: "Invalid transfer completion payload",
          });
          return;
        }

        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_COMPLETE] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_COMPLETE] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        await changeTransferStatus(sessionId, SessionStatus.COMPLETED);

        logger.info(
          `[WEB RTC] :: FILE TRANSFER COMPLETE by session :: ${sessionId}`,
        );

        socket.to(sessionId).emit("transfer-complete", { fileName });
      } catch (err: unknown) {
        logger.error(
          `[WEB RTC] :: [TRANSFER COMPLETE] :: HANDLER FAILED :: ${sessionId} with Error :: ${err}`,
        );

        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

  // error
  socket.on(
    "transfer-error",
    async ({ sessionId, message }: TransferErrorPayload): Promise<void> => {
      try {
        if (
          !sessionId ||
          typeof sessionId !== "string" ||
          !message ||
          typeof message !== "string"
        ) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_ERROR] :: SESSION OR INAVLID FILE NAME`,
          );
          socket.emit("error", { message: "Invalid transfer error payload" });
          return;
        }

        const session = await isSessionExist(sessionId);

        if (!session) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_ERROR] :: ERROR GETTING SESSION :: ${sessionId}`,
          );
          socket.emit("error", {
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logger.error(
            `[WEB RTC] :: [SOCKET:TRANSFER_ERROR] :: ERROR GETTING SESSION :: ${sessionId}`,
          );

          socket.emit("error", {
            message: "Unauthorized session access",
          });
          return;
        }

        await changeTransferStatus(sessionId, SessionStatus.ERROR);

        socket.to(sessionId).emit("transfer-error", { message });
      } catch (err: unknown) {
        logger.error(
          `[WEB RTC] :: [TRANSFER ERROR] :: HANDLER FAILED for session :: ${sessionId} with Error :: ${err}`,
        );

        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

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
