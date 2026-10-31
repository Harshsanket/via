/**
 * Session ids are always `crypto.randomUUID()` values minted by the server,
 * so anything else is refused before it reaches Redis or the logs.
 */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && SESSION_ID_PATTERN.test(value);

/**
 * Short codes are four digits today. The wider 4-6 alphanumeric shape is
 * accepted so a future config option can turn on letters without breaking
 * links created under the old setting.
 */
const SHORT_CODE_PATTERN = /^[a-z0-9]{4,6}$/;

export const isShortCode = (value: unknown): value is string =>
  typeof value === "string" && SHORT_CODE_PATTERN.test(value);
