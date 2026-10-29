import { Socket } from 'socket.io-client'
import {
  parseCreateSessionResponse,
  parseJoinSessionResponse,
} from '../lib/server-events'
import { guardAck } from './guard'
import type { CreateSessionResponse, JoinSessionResponse } from './Types'

const INVALID_RESPONSE = {
  success: false,
  message: 'The server sent an invalid response.',
} as const

/**
 * Emit "create-session" — backend creates a Redis session, joins the socket
 * room, and acks with { success, sessionId }.
 */
export const createSession = (
  socket: Socket,
  callback: (response: CreateSessionResponse) => void
): void => {
  socket.emit(
    'create-session',
    guardAck(parseCreateSessionResponse, INVALID_RESPONSE, callback),
  )
}

/**
 * Emit "join-session" — backend validates the session, joins the room,
 * refreshes TTL, and acks with { success, metadata }.
 * Also triggers "peer-joined" on the other peer's socket.
 *
 * `receiverToken` identifies this tab across a reload, so a refreshed receiver
 * can reclaim its slot before the transfer starts.
 */
export const joinSession = (
  socket: Socket,
  sessionId: string,
  receiverToken: string,
  callback: (response: JoinSessionResponse) => void
): void => {
  socket.emit(
    'join-session',
    { sessionId, receiverToken },
    guardAck(parseJoinSessionResponse, INVALID_RESPONSE, callback),
  )
}

/**
 * Emit "transfer-start" — tells the server the receiver accepted, so a later
 * rejoin cannot replace a receiver whose transfer is already in flight.
 */
export const sendTransferStart = (socket: Socket, sessionId: string): void => {
  socket.emit('transfer-start', { sessionId })
}