import { Server, Socket } from "socket.io";
import { isSessionExist } from "../redis/service.js";
import { OfferPayload, AnswerPayload, IceCandidatePayload } from "./types.js";
import { logWebRTC } from "./utils.js";
import { areValidStrings } from "../../utils/validators.js";

export const handleWebRTC = (io: Server, socket: Socket): void => {
  // OFFER
  socket.on(
    "offer",
    async ({ sessionId, offer }: OfferPayload): Promise<void> => {
      const ctx = "handleWebRTC:[offer]";
      logWebRTC("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);
      try {
        if (!areValidStrings) {
          logWebRTC("error", ctx, "SESSION INVALID");
          socket.emit("session:error", {
            success: false,
            message: "invalid session",
          });
          return;
        }

        const session = await isSessionExist(sessionId);
        if (!session) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }

        socket.to(sessionId).emit("offer", { offer });

        logWebRTC("info", ctx, `OFFER FORWARDED TO SESSION ${sessionId}`);
      } catch (err: unknown) {
        logWebRTC(
          "error",
          ctx,
          `OFFER HANDLER FAILED FOR SESSION :: ${sessionId}`,
          err,
        );
        socket.emit("session:error", {
          success: false,
          message: "internal server error",
        });
      }
    },
  );

  // ANSWER
  socket.on(
    "answer",
    async ({ sessionId, answer }: AnswerPayload): Promise<void> => {
      const ctx = "handleWebRTC:[answer]";
      logWebRTC("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);

      try {
        if (!areValidStrings) {
          logWebRTC("error", ctx, "SESSION INVALID");
          socket.emit("session:error", {
            success: false,
            message: "invalid session",
          });
          return;
        }

        const session = await isSessionExist(sessionId);
        if (!session) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }
        if (!socket.rooms.has(sessionId)) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }

        socket.to(sessionId).emit("answer", { answer });

        logWebRTC("info", ctx, `ANSWER FORWARDED TO SESSION ${sessionId}`);
      } catch (err: unknown) {
        logWebRTC(
          "error",
          ctx,
          `ANSWER HANDLER FAILED FOR SESSION :: ${sessionId}`,
          err,
        );

        socket.emit("session:error", {
          success: false,
          message: "internal server error",
        });
      }
    },
  );

  // ICE CANDIDATE
  socket.on(
    "ice-candidate",
    async ({ sessionId, candidate }: IceCandidatePayload): Promise<void> => {
      const ctx = "handleWebRTC:[ice-candidate]";
      logWebRTC("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);
      
      try {
        if (!areValidStrings) {
          logWebRTC("error", ctx, "SESSION INVALID");
          socket.emit("session:error", {
            success: false,
            message: "invalid session",
          });
          return;
        }

        const session = await isSessionExist(sessionId);
        if (!session) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }
        if (!socket.rooms.has(sessionId)) {
          logWebRTC("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }

        socket.to(sessionId).emit("ice-candidate", { candidate });
        logWebRTC(
          "info",
          ctx,
          `ICE CANDIDATE FORWARDED TO SESSION ${sessionId}`,
        );
      } catch (err: unknown) {
        logWebRTC(
          "error",
          ctx,
          `ICE CANDIDATE HANDLER FAILED FOR SESSION :: ${sessionId}`,
          err,
        );

        socket.emit("session:error", {
          success: false,
          message: "internal server error",
        });
      }
    },
  );
};
