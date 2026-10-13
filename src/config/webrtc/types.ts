// Wire contract for the signaling events. These mirror the validated payloads
// in src/config/socket/utils.ts.
export interface OfferPayload {
  sessionId: string;
  offer: RTCSessionDescriptionInit;
}

export interface AnswerPayload {
  sessionId: string;
  answer: RTCSessionDescriptionInit;
}

export interface IceCandidatePayload {
  sessionId: string;
  /** null signals "end of candidates" and is legal to relay. */
  candidate: RTCIceCandidateInit | null;
}

export interface TransferCompletePayload {
  sessionId: string;
  fileName: string;
}

export interface TransferErrorPayload {
  sessionId: string;
  message?: string;
}

export type Level = "error" | "info" | "success" | "warn";
