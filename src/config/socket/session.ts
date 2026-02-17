import { Server, Socket } from "socket.io";
export function handleSessions(io: Server, socket: Socket) {
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
}
