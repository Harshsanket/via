import { Server, Socket } from "socket.io";

export function handleWebRTC(
  io: Server,
  socket: Socket,
  isValidSessionID: (id: string) => boolean,
  isInRoom: (socket: Socket, sessionID: string) => boolean,
) {
  // WEBRTC OFFER
  socket.on("offer", ({ sessionID, offer }) => {
    if (!isValidSessionID(sessionID) || !offer) {
      return socket.emit("error", { message: "Invalid offer payload" });
    }
    if (!isInRoom(socket, sessionID)) {
      return socket.emit("error", {
        message: "You are not a member of this session",
      });
    }
    console.log(`[SOCKET] offer forwarded sessionId :: ${sessionID}`);
    socket.to(sessionID).emit("offer", { offer });
  });

  // WEBRTC ANSWER
  socket.on("answer", ({ sessionID, answer }) => {
    if (!isValidSessionID(sessionID) || !answer) {
      return socket.emit("error", { message: "Invalid answer payload" });
    }
    if (!isInRoom(socket, sessionID)) {
      return socket.emit("error", {
        message: "You are not a member of this session",
      });
    }
    console.log(`[socket] answer forwarded sessionId :: ${sessionID}`);
    socket.to(sessionID).emit("answer", { answer });
  });

  // ICE CANDIDATE
  socket.on("ice-candidate", ({ sessionID, candidate }) => {
    if (!isValidSessionID(sessionID) || !candidate) {
      return socket.emit("error", { message: "Invalid candidate payload" });
    }
    if (!isInRoom(socket, sessionID)) {
      return socket.emit("error", {
        message: "You are not a member of this session",
      });
    }
    socket.to(sessionID).emit("ice-candidate", { candidate });
  });

  socket.on("transfer-progress", ({ sessionID, progress }) => {
    if (!isValidSessionID(sessionID) || !progress) return;
    if (!isInRoom(socket, sessionID)) return;

    socket.to(sessionID).emit("progress", { progress });
  });

  socket.on("transfer-complete", ({ sessionID, fileName }) => {
    if (!isValidSessionID(sessionID)) return;
    if (!isInRoom(socket, sessionID)) return;

    console.log(
      `[socket] transfer complete sessionId :: ${sessionID} file :: ${fileName}`,
    );

    socket.to(sessionID).emit("complete", { fileName });
  });

  socket.on("transfer-error", ({ sessionID, message }) => {
    if (!isValidSessionID(sessionID)) return;
    if (!isInRoom(socket, sessionID)) return;

    console.warn(
      `[socket] transfer error  sessionId :: ${sessionID}  msg :: ${message}`,
    );

    socket.to(sessionID).emit("error", { message });
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      console.log(
        `[socket] peer left sessionId :: ${roomId} by peer :: ${socket.id}`,
      );

      socket.to(roomId).emit("peer-left");
    }
  });
}
