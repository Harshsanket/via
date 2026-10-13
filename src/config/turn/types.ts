/** Hash used to sign an ephemeral TURN password. */
export type TurnCredentialAlgorithm = "sha1" | "sha256";

/**
 * The subset of the WebRTC `RTCIceServer` shape the browser consumes. STUN
 * entries carry no credentials; TURN entries always do.
 */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface MintedIceServers {
  iceServers: IceServer[];
  /** Seconds the credentials stay valid, as reported to the client. */
  ttlSeconds: number;
  /** UNIX timestamp embedded in the TURN username; the moment it expires. */
  expiresAt: number;
  algorithm: TurnCredentialAlgorithm;
}
