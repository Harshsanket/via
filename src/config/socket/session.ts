import { ApiError } from "../../utils/api-error.js";
import {
  changeTransferStatus,
  createSession,
  getFileMetadata,
  getSessionTTL,
  joinSession,
  storeFileMetadata,
} from "../redis/service.js";
import { SessionStatus } from "../redis/types.js";
import { scheduleSessionExpiry } from "./expiry.js";
import type {
  TransferCompletePayload,
  TransferErrorPayload,
} from "../webrtc/types.js";
import type {
  CreateSessionResponse,
  JoinSessionPayload,
  JoinSessionResponse,
  TransferResponse,
  ViaSocket,
} from "./types.js";
import {
  assertSessionAccess,
  logSocket,
  parseGetFileMetadataPayload,
  parseJoinSessionPayload,
  parseSessionPayload,
  parseStoreFileMetadataPayload,
  parseTransferCompletePayload,
  parseTransferErrorPayload,
  registerHandler,
  registerSafeListener,
} from "./utils.js";

export const handleSessions = (socket: ViaSocket): void => {
  // create session
  registerHandler<Record<string, never>, CreateSessionResponse>(
    socket,
    "create-session",
    {
      context: "handleSessions:[create-session]",
      requireAck: true,
      internalErrorMessage: "session creation failed",
      parse: () => ({}) as Record<string, never>,
      handle: async (_payload, ack) => {
        const sessionId = crypto.randomUUID();

        const ttlSeconds = await createSession({
          sessionId,
          peerId: socket.id,
        });

        socket.join(sessionId);
        scheduleSessionExpiry(sessionId, ttlSeconds);

        ack?.({ success: true, sessionId });

        logSocket(
          "success",
          "handleSessions:[create-session]",
          `SESSION CREATED BY PEER :: ${socket.id} ::`,
          { sessionId, ttlSeconds },
        );
      },
    },
  );

  // join session
  registerHandler<JoinSessionPayload, JoinSessionResponse>(
    socket,
    "join-session",
    {
      context: "handleSessions:[join-session]",
      requireAck: true,
      internalErrorMessage: "failed to join session",
      parse: parseJoinSessionPayload,
      handle: async ({ sessionId }, ack) => {
        logSocket(
          "info",
          "handleSessions:[join-session]",
          `FROM ${socket.id} : FOR SESSION ${sessionId}`,
        );

        // joinSession owns existence, limit and idempotency in one atomic script.
        const { ttlSeconds } = await joinSession({
          sessionId,
          peerId: socket.id,
        });

        socket.join(sessionId);
        scheduleSessionExpiry(sessionId, ttlSeconds);
        socket.to(sessionId).emit("peer-joined");

        const metadata = await getFileMetadata(sessionId);

        ack?.({ success: true, metadata });

        logSocket(
          "success",
          "handleSessions:[join-session]",
          `PEER JOINED THE SESSION :: ${sessionId}`,
          { METADATA: metadata, ttlSeconds },
        );
      },
    },
  );

  // get ttl - retained for compatibility; clients are expected to rely on the
  // `session:expiring` push instead of polling this.
  registerHandler(socket, "get-ttl", {
    context: "handleSessions:[get-ttl]",
    parse: parseSessionPayload,
    handle: async ({ sessionId }) => {
      logSocket(
        "info",
        "handleSessions:[get-ttl]",
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId);

      const result = await getSessionTTL(sessionId, socket.id);
      socket.emit("session:ttl", result);

      logSocket("success", "handleSessions:[get-ttl]", "TTL FETCHED", result);
    },
  });

  // store metadata
  registerHandler(socket, "store-file-metadata", {
    context: "handleSessions:[store-file-metadata]",
    parse: parseStoreFileMetadataPayload,
    handle: async ({ sessionId, fileName, mimeType, fileSize }) => {
      logSocket(
        "info",
        "handleSessions:[store-file-metadata]",
        `FROM ${socket.id} : FOR SESSION ${sessionId}`,
      );

      await assertSessionAccess(socket, sessionId);

      const metadata = await storeFileMetadata(sessionId, {
        fileName,
        mimeType,
        fileSize,
      });

      socket.emit("file-metadata", { sessionId, success: true, metadata });

      logSocket(
        "success",
        "handleSessions:[store-file-metadata]",
        `METADATA SENT TO ${socket.id}`,
      );
    },
  });

  // get file metadata
  registerHandler(socket, "get-file-metadata", {
    context: "handleSessions:[get-file-metadata]",
    parse: parseGetFileMetadataPayload,
    handle: async ({ sessionId, peerId }) => {
      logSocket(
        "info",
        "handleSessions:[get-file-metadata]",
        `FROM ${peerId} : FOR SESSION ${sessionId}`,
      );

      // Room membership was not checked here, so any socket that knew a
      // session id could read another session's file details.
      await assertSessionAccess(socket, sessionId);

      const metadata = await getFileMetadata(sessionId);
      socket.emit("file-metadata", { sessionId, success: true, metadata });

      logSocket(
        "success",
        "handleSessions:[get-file-metadata]",
        `METADATA SENT TO ${peerId}`,
      );
    },
  });

  // on file transfer completion
  registerHandler<TransferCompletePayload, TransferResponse>(
    socket,
    "transfer-complete",
    {
      context: "handleSessions:[transfer-complete]",
      parse: parseTransferCompletePayload,
      handle: async ({ sessionId, fileName }, ack) => {
        logSocket(
          "info",
          "handleSessions:[transfer-complete]",
          `FROM ${socket.id} : FOR SESSION ${sessionId}`,
        );

        await assertSessionAccess(socket, sessionId, {
          missing: "session expired or invalid",
          forbidden: "peer not in session",
        });

        await changeTransferStatus(sessionId, SessionStatus.COMPLETED);

        // Previously `socket.once`, so a socket could only ever report one
        // completed transfer for its whole lifetime.
        socket
          .to(sessionId)
          .emit("transfer-complete", { success: true, fileName });
        ack?.({ success: true, message: "transfer complete" });

        logSocket(
          "success",
          "handleSessions:[transfer-complete]",
          `FILE TRANSFER COMPLETE BY SESSION :: ${sessionId}`,
        );
      },
    },
  );

  // on error
  registerHandler<TransferErrorPayload, TransferResponse>(
    socket,
    "transfer-error",
    {
      context: "handleSessions:[transfer-error]",
      parse: parseTransferErrorPayload,
      handle: async ({ sessionId }, ack) => {
        logSocket(
          "info",
          "handleSessions:[transfer-error]",
          `FROM ${socket.id} : FOR SESSION ${sessionId}`,
        );

        await assertSessionAccess(socket, sessionId);

        await changeTransferStatus(sessionId, SessionStatus.ERROR);

        socket.to(sessionId).emit("transfer-error", { success: true });
        ack?.({ success: true, message: "transfer error recorded" });

        logSocket(
          "success",
          "handleSessions:[transfer-error]",
          `CHANGED FILE TRANSFER STATUS TO ERROR FOR :: ${sessionId}`,
        );
      },
    },
  );

  // disconnecting - notify only. Membership is released atomically by
  // cleanupOnDisconnect on `disconnect`, so this cannot double count, and the
  // expiry timers stay untouched because the session may well outlive this
  // peer (only the creator's departure ends it).
  registerSafeListener(
    socket,
    "disconnecting",
    "handleSessions:[disconnecting]",
    () => {
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue;

        socket.to(roomId).emit("peer-left");

        logSocket(
          "warn",
          "handleSessions:[disconnecting]",
          `[DISCONNECTING]:: Peer :: ${socket.id} session :: ${roomId}`,
        );
      }
    },
  );
};
