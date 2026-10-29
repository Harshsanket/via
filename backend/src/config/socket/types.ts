import type { Server, Socket } from "socket.io";
import type { FileMetaData, TTLMeta } from "../redis/types.js";
import type {
  AnswerPayload,
  IceCandidatePayload,
  OfferPayload,
  TransferCompletePayload,
  TransferErrorPayload,
} from "../webrtc/types.js";

export type Level = "error" | "info" | "success" | "warn";

/**
 * The wire contract, in one place.
 *
 * This file is the single source of truth for event names and payload shapes:
 * the client can consume it directly, and the parsers in ./utils.ts return
 * these same types, so a change here cannot drift from what the server accepts.
 */

// Payloads sent by the client
export interface SessionIdPayload {
  sessionId: string;
}

export type JoinSessionPayload = SessionIdPayload & {
  /**
   * Per-tab identity the receiver keeps in sessionStorage. A reloaded page
   * sends the same token, so it can reclaim its own slot before the transfer
   * starts; a third peer's token does not match and is still refused.
   */
  receiverToken?: string;
};

export interface StoreFileMetadataPayload {
  sessionId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface GetFileMetadataPayload {
  sessionId: string;
  peerId: string;
}

// Responses
export interface ErrorResponse {
  success: false;
  message: string;
}

export type AckResponse = { success: boolean; message?: string };

export type CreateSessionResponse =
  | { success: true; sessionId: string }
  | ErrorResponse;

export type JoinSessionResponse =
  | { success: true; metadata: FileMetaData | null }
  | ErrorResponse;

export type TransferResponse =
  | { success: true; message: string }
  | ErrorResponse;

export interface FileMetadataPayload {
  sessionId: string;
  success: true;
  /** null while the sender has not selected a file yet. */
  metadata: FileMetaData | null;
}

export interface SessionExpiringPayload {
  sessionId: string;
  secondsRemaining: number;
}

export interface SessionExpiredPayload {
  sessionId: string;
}

/** Ack callback shape, with the response type the server will send. */
export type Ack<T> = (response: T) => void;

export interface ClientToServerEvents {
  "create-session": (ack: Ack<CreateSessionResponse>) => void;
  "join-session": (
    payload: JoinSessionPayload,
    ack: Ack<JoinSessionResponse>,
  ) => void;
  "get-ttl": (payload: SessionIdPayload) => void;
  "store-file-metadata": (payload: StoreFileMetadataPayload) => void;
  "get-file-metadata": (payload: GetFileMetadataPayload) => void;
  "transfer-start": (payload: SessionIdPayload) => void;
  "transfer-complete": (
    payload: TransferCompletePayload,
    ack?: Ack<TransferResponse>,
  ) => void;
  "transfer-error": (
    payload: TransferErrorPayload,
    ack?: Ack<TransferResponse>,
  ) => void;
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  disconnecting: () => void;
}

export interface ServerToClientEvents {
  "peer-joined": () => void;
  "peer-left": () => void;
  "session:error": (payload: ErrorResponse) => void;
  "session:ttl": (payload: TTLMeta) => void;
  /** Push before expiry so clients do not poll `get-ttl`. */
  "session:expiring": (payload: SessionExpiringPayload) => void;
  "session:expired": (payload: SessionExpiredPayload) => void;
  "file-metadata": (payload: FileMetadataPayload) => void;
  "transfer-complete": (payload: { success: true; fileName: string }) => void;
  "transfer-error": (payload: { success: true }) => void;
  offer: (payload: { offer: RTCSessionDescriptionInit }) => void;
  answer: (payload: { answer: RTCSessionDescriptionInit }) => void;
  "ice-candidate": (payload: { candidate: RTCIceCandidateInit | null }) => void;
}

/** Reserved for future inter-server (adapter) events. */
export interface InterServerEvents {}

export interface SocketData {
  peerId: string;
}

export type ViaServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type ViaSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
