export const areValidStrings = (...values: unknown[]): boolean => {
  return values.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
};

/**
 * Session ids are always `crypto.randomUUID()` values minted by the server,
 * so anything else is refused before it reaches Redis or the logs.
 */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && SESSION_ID_PATTERN.test(value);
