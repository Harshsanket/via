import { ApiError } from "../../utils/api-error.js";
import { logger } from "../../utils/logger.js";
import { isSessionExist } from "../redis/service.js";
import type { FileMetaData } from "../redis/types.js";
import type {
  AnswerPayload,
  IceCandidatePayload,
  OfferPayload,
  TransferCompletePayload,
  TransferErrorPayload,
} from "../webrtc/types.js";
import type {
  Ack,
  AckResponse,
  GetFileMetadataPayload,
  JoinSessionPayload,
  Level,
  SessionIdPayload,
  StoreFileMetadataPayload,
  ViaSocket,
} from "./types.js";

export const MAX_FILE_SIZE: number = 50 * 1024 * 1024 * 1024;

export type { Ack } from "./types.js";

/** Expected failure that is safe to show to the client. */
export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

export const logSocket = (
  level: Level,
  context: string,
  message: string,
  meta?: unknown,
): void => {
  const payload =
    meta === undefined ? {} : meta instanceof Error ? { err: meta } : { meta };

  if (level === "error") {
    logger.error(payload, `[SOCKET] :: [ERROR] :: [${context}] :: ${message}`);
  }
  if (level === "success") {
    logger.info(payload, `[SOCKET] :: [SUCCESS] :: [${context}] :: ${message}`);
  }
  if (level === "warn") {
    logger.warn(payload, `[SOCKET] :: [WARN] :: [${context}] :: ${message}`);
  }
  if (level === "info") {
    logger.info(
      payload,
      `[SOCKET] :: [REQUEST RECEIVED] :: [${context}] :: ${message}`,
    );
  }
};

export const isCallback = (cb: unknown): cb is Ack<AckResponse> => {
  return typeof cb === "function";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isSessionDescription = (
  value: unknown,
): value is RTCSessionDescriptionInit =>
  isRecord(value) &&
  isNonEmptyString(value.type) &&
  typeof value.sdp === "string";

const isIceCandidate = (value: unknown): value is RTCIceCandidateInit | null =>
  value === null ||
  (isRecord(value) &&
    (value.candidate === undefined || typeof value.candidate === "string"));

export const isValidFileMetadata = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== "object") return false;

  const m = metadata as {
    fileName?: unknown;
    mimeType?: unknown;
    fileSize?: unknown;
  };

  if (m.fileName == null || m.mimeType == null || m.fileSize == null) {
    return false;
  }

  if (
    typeof m.fileName !== "string" ||
    typeof m.mimeType !== "string" ||
    typeof m.fileSize !== "number"
  ) {
    return false;
  }

  if (m.fileName.trim().length === 0) return false;

  if (m.fileSize <= 0 || m.fileSize > MAX_FILE_SIZE) {
    return false;
  }

  return true;
};

// ---------------------------------------------------------------------------
// Payload parsers. Every socket event goes through one of these before a
// handler runs, so a malformed payload can never reach business logic. Return
// types mirror the contract in ./types.ts.
// ---------------------------------------------------------------------------

export const parseSessionPayload = (
  payload: unknown,
  message = "invalid session id",
): SessionIdPayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError(message);
  }
  return { sessionId: payload.sessionId };
};

export const parseJoinSessionPayload = (payload: unknown): JoinSessionPayload =>
  parseSessionPayload(payload, "session id invalid");

export const parseStoreFileMetadataPayload = (
  payload: unknown,
): StoreFileMetadataPayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError("invalid session id");
  }
  if (!isValidFileMetadata(payload)) {
    throw new InvalidPayloadError("invalid file metadata");
  }
  return {
    sessionId: payload.sessionId,
    fileName: payload.fileName as string,
    mimeType: payload.mimeType as string,
    fileSize: payload.fileSize as number,
  };
};

export const parseGetFileMetadataPayload = (
  payload: unknown,
): GetFileMetadataPayload => {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.sessionId) ||
    !isNonEmptyString(payload.peerId)
  ) {
    throw new InvalidPayloadError("session or filename invalid");
  }
  return {
    sessionId: payload.sessionId,
    peerId: payload.peerId,
  };
};

export const parseTransferCompletePayload = (
  payload: unknown,
): TransferCompletePayload => {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.sessionId) ||
    !isNonEmptyString(payload.fileName)
  ) {
    throw new InvalidPayloadError("session or filename invalid");
  }
  return { sessionId: payload.sessionId, fileName: payload.fileName };
};

export const parseTransferErrorPayload = (
  payload: unknown,
): TransferErrorPayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError("invalid transfer error payload");
  }
  return {
    sessionId: payload.sessionId,
    message: isNonEmptyString(payload.message) ? payload.message : undefined,
  };
};

export const parseOfferPayload = (payload: unknown): OfferPayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError("invalid session");
  }
  if (!isSessionDescription(payload.offer)) {
    throw new InvalidPayloadError("invalid offer");
  }
  return { sessionId: payload.sessionId, offer: payload.offer };
};

export const parseAnswerPayload = (payload: unknown): AnswerPayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError("invalid session");
  }
  if (!isSessionDescription(payload.answer)) {
    throw new InvalidPayloadError("invalid answer");
  }
  return { sessionId: payload.sessionId, answer: payload.answer };
};

export const parseIceCandidatePayload = (
  payload: unknown,
): IceCandidatePayload => {
  if (!isRecord(payload) || !isNonEmptyString(payload.sessionId)) {
    throw new InvalidPayloadError("invalid session");
  }
  if (!isIceCandidate(payload.candidate)) {
    throw new InvalidPayloadError("invalid ice candidate");
  }
  return { sessionId: payload.sessionId, candidate: payload.candidate };
};

// ---------------------------------------------------------------------------
// Shared authorization helpers
// ---------------------------------------------------------------------------

export const assertSessionAccess = async (
  socket: ViaSocket,
  sessionId: string,
  messages: { missing?: string; forbidden?: string } = {},
): Promise<void> => {
  const missing = messages.missing ?? "session expired or invalid";
  const forbidden = messages.forbidden ?? "unauthorized session access";

  if (!(await isSessionExist(sessionId))) {
    throw new ApiError(404, missing);
  }
  if (!socket.rooms.has(sessionId)) {
    throw new ApiError(403, forbidden);
  }
};

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export interface HandlerConfig<T, R extends AckResponse = AckResponse> {
  context: string;
  /** Throws InvalidPayloadError for anything the handler must not see. */
  parse: (payload: unknown) => T;
  handle: (payload: T, ack: Ack<R> | null) => Promise<void> | void;
  requireAck?: boolean;
  /** Message used when an unexpected error happens. */
  internalErrorMessage?: string;
}

/**
 * Binds a listener for a runtime event name.
 *
 * Socket.IO's typed `on` overloads cannot express a handler that receives
 * unknown arguments and validates them itself, which is exactly what this
 * module does, so the binding goes through this narrow cast.
 */
const bindListener = (
  socket: ViaSocket,
  event: string,
  listener: (...args: unknown[]) => void,
): void => {
  const on = socket.on.bind(socket) as (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;

  on(event, listener);
};

const toClientMessage = (error: unknown, fallback: string): string => {
  if (error instanceof InvalidPayloadError) return error.message;
  if (error instanceof ApiError && error.statusCode < 500) return error.message;
  return fallback;
};

/**
 * Registers a socket listener that validates its payload, always answers the
 * client and never lets an exception escape into the event loop.
 *
 * Without this, `socket.emit("join-session")` (no payload) throws inside the
 * listener and takes the whole process down, because Socket.IO does not wrap
 * listener invocations and no uncaughtException handler is installed.
 */
export const registerHandler = <T, R extends AckResponse = AckResponse>(
  socket: ViaSocket,
  event: string,
  config: HandlerConfig<T, R>,
): void => {
  bindListener(socket, event, (...rawArgs: unknown[]) => {
    const lastArg = rawArgs[rawArgs.length - 1];
    let ack: Ack<AckResponse> | null = null;
    if (isCallback(lastArg)) {
      rawArgs.pop();
      ack = lastArg;
    }
    const payload = rawArgs[0];

    const respond = (body: AckResponse): void => {
      if (ack) ack(body);
      else
        socket.emit("session:error", {
          success: false,
          message: body.message ?? "internal server error",
        });
    };

    void (async () => {
      try {
        if (config.requireAck && !ack) {
          throw new InvalidPayloadError("missing acknowledgement callback");
        }

        const parsed = config.parse(payload);
        await config.handle(parsed, ack);
      } catch (error) {
        const message = toClientMessage(
          error,
          config.internalErrorMessage ?? "internal server error",
        );
        const expected =
          error instanceof InvalidPayloadError ||
          (error instanceof ApiError && error.statusCode < 500);

        logSocket(expected ? "warn" : "error", config.context, message, error);

        try {
          respond({ success: false, message });
        } catch (ackError) {
          logSocket(
            "error",
            config.context,
            "FAILED TO SEND ERROR RESPONSE",
            ackError,
          );
        }
      }
    })();
  });
};

/** Registers a lifecycle listener (connect/disconnect) with error isolation. */
export const registerSafeListener = (
  socket: ViaSocket,
  event: string,
  context: string,
  handler: () => Promise<void> | void,
): void => {
  bindListener(socket, event, () => {
    void (async () => {
      try {
        await handler();
      } catch (error) {
        logSocket("error", context, `HANDLER FAILED :: ${event}`, error);
      }
    })();
  });
};
