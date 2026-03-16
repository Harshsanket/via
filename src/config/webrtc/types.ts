<<<<<<< HEAD
import { FileMetaData } from "config/redis/types.js";

=======
>>>>>>> main
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

<<<<<<< HEAD
export interface FileMetadataPayload {
  sessionId: string;
  metadata: FileMetaData;
}

=======
>>>>>>> main
export interface TransferCompletePayload {
  sessionId: string;
  fileName: string;
}

export interface TransferErrorPayload {
  sessionId: string;
  message: string;
}
<<<<<<< HEAD
=======

export type Level = "error" | "info" | "success" | "warn";
>>>>>>> main
