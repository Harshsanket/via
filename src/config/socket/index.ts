import { Server, Socket } from "socket.io";
import crypto from "crypto";
import { isInRoom, isValidSessionID } from "./validators.js";
import { handleWebRTC } from "./webrtc.js";

export const initSocket = (io: Server) => {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected :: ${socket.id}`);

    socket.on("create-session", (callback) => {
      if (typeof callback !== "function") return;
      const sessionID = crypto.randomUUID();
      socket.join(sessionID);
      console.log(
        `[SOCKET] session created with sessionId :: ${sessionID} by sockedId :: ${socket.id}`,
      );
      callback({ sessionID });
    });

    socket.on("join-session", ({ sessionID }, callback) => {
      if (typeof callback !== "function") return;
      const room = io.sockets.adapter.rooms.get(sessionID);

      if (!room) {
        return callback({ error: "Session does not exist" });
      }

      if (room.size >= 2) {
        return callback({ error: "Room is full" });
      }

      socket.join(sessionID);
      socket.to(sessionID).emit("peer-joined");
      console.log(
        `[SOCKET] peer joined with sessionId :: ${sessionID} by peer :: ${socket.id}`,
      );

      callback({ success: true });
    });

    //WEBRTC
    handleWebRTC(io, socket, isValidSessionID, isInRoom);

    socket.on("disconnect", () => {
      console.log(`Socket Disconnected :: ${socket.id}`);
    });
  });
};
