import type { ViaSocket } from "../socket/types.js";
import {
  assertSessionAccess,
  parseAnswerPayload,
  parseIceCandidatePayload,
  parseOfferPayload,
  registerHandler,
} from "../socket/utils.js";
import { logWebRTC } from "./utils.js";

// Relay logs are debug: a negotiation sends dozens of candidates, and at
// info level one client could fill the logs. Errors are still logged by
// registerHandler at warn/error.
export const handleWebRTC = (socket: ViaSocket): void => {
  // OFFER
  const offerContext = "handleWebRTC:[offer]";
  registerHandler(socket, "offer", {
    context: offerContext,
    parse: parseOfferPayload,
    handle: async ({ sessionId, offer }) => {
      logWebRTC(
        "debug",
        offerContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("offer", { offer });

      logWebRTC(
        "debug",
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
        "debug",
        answerContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("answer", { answer });

      logWebRTC(
        "debug",
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
        "debug",
        iceContext,
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId, {
        missing: "Session expired or invalid",
        forbidden: "Session expired or invalid",
      });

      socket.to(sessionId).emit("ice-candidate", { candidate });

      logWebRTC(
        "debug",
        iceContext,
        `ICE CANDIDATE FORWARDED TO SESSION ${sessionId}`,
      );
    },
  });
};
