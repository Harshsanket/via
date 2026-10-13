import type { ViaSocket } from "../socket/types.js";
import {
  assertSessionAccess,
  parseAnswerPayload,
  parseIceCandidatePayload,
  parseOfferPayload,
  registerHandler,
} from "../socket/utils.js";
import { logWebRTC } from "./utils.js";

export const handleWebRTC = (socket: ViaSocket): void => {
  // OFFER
  const offerContext = "handleWebRTC:[offer]";
  registerHandler(socket, "offer", {
    context: offerContext,
    parse: parseOfferPayload,
    handle: async ({ sessionId, offer }) => {
      logWebRTC(
        "info",
        offerContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("offer", { offer });

      logWebRTC(
        "info",
        offerContext,
        `OFFER FORWARDED TO SESSION ${sessionId}`,
      );
    },
  });

  // ANSWER
  const answerContext = "handleWebRTC:[answer]";
  registerHandler(socket, "answer", {
    context: answerContext,
    parse: parseAnswerPayload,
    handle: async ({ sessionId, answer }) => {
      logWebRTC(
        "info",
        answerContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("answer", { answer });

      logWebRTC(
        "info",
        answerContext,
        `ANSWER FORWARDED TO SESSION ${sessionId}`,
      );
    },
  });

  // ICE CANDIDATE
  const iceContext = "handleWebRTC:[ice-candidate]";
  registerHandler(socket, "ice-candidate", {
    context: iceContext,
    parse: parseIceCandidatePayload,
    handle: async ({ sessionId, candidate }) => {
      logWebRTC(
        "info",
        iceContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("ice-candidate", { candidate });

      logWebRTC(
        "info",
        iceContext,
        `ICE CANDIDATE FORWARDED TO SESSION ${sessionId}`,
      );
    },
  });
};
