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

interface FileMetadata {
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface FileMetadataPayload {
  sessionId: string;
  metadata: FileMetadata;
}

export interface TransferCompletePayload {
  sessionId: string;
  fileName: string;
}

export interface TransferErrorPayload {
  sessionId: string;
  message: string;
}