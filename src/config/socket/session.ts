import { Server, Socket } from "socket.io";
import {
  changeTransferStatus,
  createSession,
  decreasePeersCount,
  getFileMetadata,
  getSessionTTL,
  isSessionExist,
  joinSession,
  refreshSessionTTL,
  storeFileMetadata,
} from "../redis/service.js";
import { isCallback, logSocket } from "./utils.js";
import { areValidStrings } from "../../utils/validators.js";
import {
  TransferCompletePayload,
  TransferErrorPayload,
} from "config/webrtc/types.js";
import { SessionStatus } from "../redis/types.js";

export const handleSessions = (io: Server, socket: Socket): void => {
  // create session
  socket.on("create-session", async (callback) => {
    const ctx = "handleSessions:[create-session]";
    logSocket("info", "handleSessions:[create-session]", `FROM ${socket.id}`);

    if (!isCallback(callback)) {
      logSocket("error", ctx, "INVALID CALLBACK");
      callback({ success: false, message: "session creation failed" });
      return;
    }

    try {
      const sessionId = crypto.randomUUID();
      const createSessionParam = {
        sessionId,
        peerId: socket.id,
      };

      await createSession(createSessionParam);

      socket.join(sessionId);

      callback({
        success: true,
        sessionId,
      });
      logSocket(
        "success",
        ctx,
        `SESSION CREATED BY PEER :: ${socket.id} ::`,
        sessionId,
      );
    } catch (error) {
      logSocket("error", ctx, "ERROR WHILE CREATING SESSION", error);
      callback({ success: false, message: "session creation failed" });
    }
  });

  // join session
  socket.on("join-session", async ({ sessionId }, callback) => {
    const ctx = "handleSessions:[join-session]";
    logSocket("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);

    if (!isCallback(callback)) {
      logSocket("error", ctx, "INVALID CALLBACK");
      callback({ success: false, message: "session joining failed" });
      return;
    }

    if (!areValidStrings(sessionId)) {
      logSocket("error", ctx, "INVALID SESSION_ID");
      callback({ success: false, message: "session id invalid" });
      return;
    }

    try {
      const sessionExists = await isSessionExist(sessionId);
      if (!sessionExists) {
        logSocket("error", ctx, "SESSION DOES NOT EXIST");
        callback({ success: false, message: "session expired or invalid" });
        return;
      }

      const joinSessionParam = {
        sessionId,
        peerId: socket.id,
      };

      await joinSession(joinSessionParam);
      socket.join(sessionId);
      socket.to(sessionId).emit("peer-joined");

      await refreshSessionTTL(sessionId);
      const metadata = await getFileMetadata(sessionId);

      callback({ success: true, metadata });
      logSocket("success", ctx, `PEER JOINED THE SESSION :: ${sessionId}`, {
        METADATA: metadata,
      });
    } catch (error) {
      logSocket("error", ctx, "ERROR WHILE JOINING SESSION", error);
      callback({ success: false, message: "failed to join session" });
    }
  });

  // get ttl
  socket.on("get-ttl", async ({ sessionId }) => {
    const ctx = "handleSessions:[get-ttl]";
    logSocket("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);

    if (!areValidStrings(sessionId)) {
      logSocket("error", ctx, "INVALID SESSION_ID");
      socket.emit("session:error", {
        success: false,
        message: "invalid session id",
      });
      return;
    }

    try {
      const session = await isSessionExist(sessionId);
      if (!session) {
        logSocket("error", ctx, `SESSION NOT FOUND OR EXPIRED :: ${sessionId}`);
        socket.emit("session:error", {
          success: false,
          message: "session expired or invalid",
        });
        return;
      }

      if (!socket.rooms.has(sessionId)) {
        logSocket("error", ctx, `SOCKET NOT IN SESSION ROOM :: ${sessionId}`);
        socket.emit("session:error", {
          success: false,
          message: "unauthorized session access",
        });
        return;
      }

      const result = await getSessionTTL(sessionId, socket.id);
      socket.emit("session:ttl", result);
      logSocket("success", ctx, "TTL FETCHED", result);
    } catch (error) {
      logSocket("error", ctx, "ERROR WHILE FETCHING TTL", error);
      socket.emit("session:error", {
        success: false,
        message: "internal server error",
      });
    }
  });

  // store metadata
  socket.on("get-file-metadata", async ({ sessionId }) => {
    const ctx = "handleSessions:[get-file-metadata]";
    logSocket("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);

    if (!areValidStrings(sessionId)) {
      logSocket("error", ctx, "INVALID SESSION ID");
      socket.emit("session:error", {
        success: false,
        message: "invalid session id",
      });
      return;
    }

    try {
      const session = await isSessionExist(sessionId);
      if (!session) {
        logSocket("error", ctx, `SESSION NOT FOUND OR EXPIRED :: ${sessionId}`);
        socket.emit("session:error", {
          success: false,
          message: "session expired or invalid",
        });
        return;
      }

      if (!socket.rooms.has(sessionId)) {
        logSocket("error", ctx, `SOCKET NOT IN SESSION ROOM :: ${sessionId}`);
        socket.emit("session:error", {
          success: false,
          message: "unauthorized session access",
        });
        return;
      }

      const metadata = await getFileMetadata(sessionId);
      socket.emit("file-metadata", {
        success: true,
        metadata,
      });

      logSocket("success", ctx, `METADATA SENT TO ${socket.id}`);
    } catch (error) {
      logSocket("error", ctx, "ERROR WHILE GETTING FILE METADATA", error);
      socket.emit("session:error", {
        success: false,
        message: "internal server error",
      });
    }
  });

  // get file metadata
  socket.on("get-file-metadata", async ({ sessionId, peerId }) => {
    const ctx = "handleSessions:[get-file-metadata]";
    logSocket("info", ctx, `FROM ${peerId} : FOR SESSION ${sessionId}`);

    if (!areValidStrings(sessionId, peerId)) {
      logSocket("error", ctx, "SESSION OR PEER ID INVALID");
      socket.emit("session:error", {
        success: false,
        message: "session or filename invalid",
      });
    }

    try {
      const metadata = await getFileMetadata(sessionId);
      socket.emit("file-metadata", {
        success: true,
        metadata,
      });

      logSocket("success", ctx, `METADATA SENT TO ${peerId}`);
    } catch (error) {
      logSocket("error", ctx, "ERROR WHILE GETTING FILE METADATA", error);
      socket.emit("session:error", {
        success: false,
        message: "internal server error",
      });
    }
  });

  // on file transfer completion
  socket.once(
    "transfer-complete",
    async ({ sessionId, fileName }: TransferCompletePayload): Promise<void> => {
      const ctx = "handleSessions:[transfer-complete]";
      logSocket("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);
      try {
        if (!areValidStrings(sessionId, fileName)) {
          logSocket("error", ctx, "SESSION OR PEER ID INVALID");
          socket.emit("session:error", {
            success: false,
            message: "session or filename invalid",
          });
          return;
        }

        const session = await isSessionExist(sessionId);
        if (!session) {
          logSocket("error", ctx, "ERROR GETTING SESSION");
          socket.emit("session:error", {
            success: false,
            message: "Session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logSocket("error", ctx, "PEER NOT IN SESSION");

          socket.emit("session:error", {
            success: false,
            message: "peer not in session",
          });
          return;
        }

        await changeTransferStatus(sessionId, SessionStatus.COMPLETED);

        logSocket(
          "success",
          ctx,
          `FILE TRANSFER COMPLETE BY SESSION :: ${sessionId}`,
        );

        socket.to(sessionId).emit("transfer-complete", { fileName });
      } catch (err: unknown) {
        logSocket("error", ctx, "FILE HANDLER FAILED", err);
        socket.emit("error", {
          message: "Internal server error",
        });
      }
    },
  );

  // on error
  socket.on(
    "transfer-error",
    async ({ sessionId }: TransferErrorPayload): Promise<void> => {
      const ctx = "handleTransfer:[transfer-error]";

      logSocket("info", ctx, `FROM ${socket.id} : FOR SESSION ${sessionId}`);

      try {
        if (!areValidStrings(sessionId)) {
          logSocket("error", ctx, "SESSION ID OR MESSAGE INVALID");
          socket.emit("session:error", {
            success: false,
            message: "invalid transfer error payload",
          });
          return;
        }

        const session = await isSessionExist(sessionId);
        if (!session) {
          logSocket(
            "error",
            ctx,
            `SESSION NOT FOUND OR EXPIRED :: ${sessionId}`,
          );
          socket.emit("session:error", {
            success: false,
            message: "session expired or invalid",
          });
          return;
        }

        if (!socket.rooms.has(sessionId)) {
          logSocket("error", ctx, `SOCKET NOT IN SESSION ROOM :: ${sessionId}`);
          socket.emit("session:error", {
            success: false,
            message: "unauthorized session access",
          });
          return;
        }

        await changeTransferStatus(sessionId, SessionStatus.ERROR);

        socket.to(sessionId).emit("transfer-error", { success: true });
        logSocket(
          "success",
          ctx,
          `CHANGED FILE TRANSFER STATUS TO ERROR FOR :: ${sessionId}`,
        );
      } catch (err: unknown) {
        logSocket(
          "error",
          ctx,
          `HANDLER FAILED :: SESSION ${sessionId} :: ${err}`,
        );
        socket.emit("session:error", {
          success: false,
          message: "internal server error",
        });
      }
    },
  );

  // disconneting
  socket.on("disconnecting", async () => {
    const ctx = "handleTransfer:[disconnecting]";

    logSocket("info", ctx, "FROM ${socket.id}");

    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      try {
        await decreasePeersCount(roomId);
      } catch (error) {
        logSocket("error", ctx, "ERROR CHANGING SESSION STATUS");
      }

      logSocket(
        "warn",
        ctx,
        `[DISCONNECTED]:: Peer :: ${socket.id} session :: ${roomId}`,
      );
      socket.to(roomId).emit("peer-left");
    }
  });
};
