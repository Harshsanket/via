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
 */
export const joinSession = (
  socket: Socket,
  sessionId: string,
  callback: (response: JoinSessionResponse) => void
): void => {
  socket.emit(
    'join-session',
    { sessionId },
    guardAck(parseJoinSessionResponse, INVALID_RESPONSE, callback),
  )
}