export function isSessionIdValid(sessionID: unknown): sessionID is string {
  return typeof sessionID === "string";
}
