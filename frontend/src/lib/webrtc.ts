/**
 * Buffers trickled ICE candidates until the remote description exists.
 * Candidates that arrive too early would otherwise be rejected by the browser
 * and the connection can fail.
 */
export class IceCandidateBuffer {
  private pending: RTCIceCandidateInit[] = []
  private remoteDescriptionSet = false
  private chain: Promise<void> = Promise.resolve()

  add(pc: RTCPeerConnection, candidate: RTCIceCandidateInit | null): void {
    if (!candidate) return

    if (!this.remoteDescriptionSet) {
      this.pending.push(candidate)
      return
    }

    this.chain = this.chain.then(() => this.addNow(pc, candidate))
  }

  markRemoteDescriptionSet(pc: RTCPeerConnection): Promise<void> {
    this.remoteDescriptionSet = true
    const queued = this.pending
    this.pending = []

    for (const candidate of queued) {
      this.chain = this.chain.then(() => this.addNow(pc, candidate))
    }

    return this.chain
  }

  reset(): void {
    this.pending = []
    this.remoteDescriptionSet = false
    this.chain = Promise.resolve()
  }

  private async addNow(
    pc: RTCPeerConnection,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (error) {
      console.warn('Failed to add ICE candidate', error)
    }
  }
}

export function closePeerConnection(pc: RTCPeerConnection | null): void {
  if (!pc) return
  pc.onicecandidate = null
  pc.onconnectionstatechange = null
  pc.oniceconnectionstatechange = null
  pc.ondatachannel = null
  pc.close()
}

export function createPeerConnectionConfig(
  iceServers: RTCIceServer[],
): RTCConfiguration {
  return {
    iceServers,
    iceCandidatePoolSize: 4,
  }
}
