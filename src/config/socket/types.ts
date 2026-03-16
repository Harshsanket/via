import { FileMetaData } from "config/redis/types.js";

export type Level = "error" | "info" | "success" | "warn";

export interface FileMetadataPayload {
  sessionId: string;
  metadata: FileMetaData;
}
