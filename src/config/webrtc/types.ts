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
  candidate: RTCIceCandidateInit;
}

export interface TransferCompletePayload {
  sessionId: string;
  fileName: string;
}

export interface TransferErrorPayload {
  sessionId: string;
  message: string;
}

export type Level = "error" | "info" | "success" | "warn";
