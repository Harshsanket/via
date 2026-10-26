import { io, Socket } from 'socket.io-client'
import { socketServerUrl } from '../lib/env'

let socket: Socket | null = null

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(socketServerUrl, {
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      timeout: 10_000,
      closeOnBeforeunload: false,
    })
  }
  return socket
}
