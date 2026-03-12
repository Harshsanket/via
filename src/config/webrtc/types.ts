import { FileMetaData } from "config/redis/types.js";

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

export interface FileMetadataPayload {
  sessionId: string;
  metadata: FileMetaData;
}

export interface TransferCompletePayload {
  sessionId: string;
  fileName: string;
}

export interface TransferErrorPayload {
  sessionId: string;
  message: string;
}
