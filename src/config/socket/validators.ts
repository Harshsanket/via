import { Socket } from "socket.io";

// Room check
export function isInRoom(socket: Socket, sessionId: string): boolean {
  return socket.rooms.has(sessionId);
}

// Session ID check
export function isValidSessionID(sessionID: unknown): sessionID is string {
  return (
    typeof sessionID === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionID,
    )
  );
}
