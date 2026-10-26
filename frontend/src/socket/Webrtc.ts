import { Socket } from 'socket.io-client'
import {
  parseIceCandidateEvent,
  parseTransferCompleteEvent,
  parseTransferErrorEvent,
} from '../lib/server-events'
import { listen, unlisten } from './guard'

import { parseDescriptionEvent } from '../lib/server-events'
import type {
  OfferEvent,
  AnswerEvent,
  IceCandidateEvent,
  TransferCompleteEvent,
  TransferErrorEvent,
} from './Types'

// ─── Emitters ─────────────────────────────────────────────────────────────────

export const sendOffer = (
  socket: Socket,
  sessionId: string,
  offer: RTCSessionDescriptionInit,
): void => {
  socket.emit('offer', { sessionId, offer })
}

export const sendAnswer = (
  socket: Socket,
  sessionId: string,
  answer: RTCSessionDescriptionInit,
): void => {
  socket.emit('answer', { sessionId, answer })
}

export const sendIceCandidate = (
  socket: Socket,
  sessionId: string,
  candidate: RTCIceCandidateInit | null,
): void => {
  socket.emit('ice-candidate', { sessionId, candidate })
}

export const sendFileMetadata = (
  socket: Socket,
  sessionId: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): void => {
  socket.emit('store-file-metadata', {
    sessionId,
    fileName,
    mimeType,
    fileSize,
  })
}

/**
 * The receiver calls this after it has assembled and verified the file.
 * The sender marks itself done as soon as the bytes are handed to WebRTC.
 */
export const sendTransferComplete = (
  socket: Socket,
  sessionId: string,
  fileName: string,
): void => {
  socket.emit('transfer-complete', { sessionId, fileName })
}

export const sendTransferError = (
  socket: Socket,
  sessionId: string,
  message: string,
): void => {
  socket.emit('transfer-error', { sessionId, message })
}

/** Ask for the TTL once; the server pushes expiry warnings afterwards. */
export const getTTL = (socket: Socket, sessionId: string): void => {
  socket.emit('get-ttl', { sessionId })
}

// ─── Listeners ────────────────────────────────────────────────────────────────

const parseOfferEvent = (raw: unknown) => parseDescriptionEvent(raw, 'offer')
const parseAnswerEvent = (raw: unknown) => parseDescriptionEvent(raw, 'answer')

export const onOffer = (
  socket: Socket,
  callback: (data: OfferEvent) => void,
): void => {
  listen(socket, 'offer', parseOfferEvent, callback)
}

export const offOffer = (
  socket: Socket,
  callback: (data: OfferEvent) => void,
): void => {
  unlisten(socket, 'offer', callback)
}

export const onAnswer = (
  socket: Socket,
  callback: (data: AnswerEvent) => void,
): void => {
  listen(socket, 'answer', parseAnswerEvent, callback)
}

export const offAnswer = (
  socket: Socket,
  callback: (data: AnswerEvent) => void,
): void => {
  unlisten(socket, 'answer', callback)
}

export const onIceCandidate = (
  socket: Socket,
  callback: (data: IceCandidateEvent) => void,
): void => {
  listen(socket, 'ice-candidate', parseIceCandidateEvent, callback)
}

export const offIceCandidate = (
  socket: Socket,
  callback: (data: IceCandidateEvent) => void,
): void => {
  unlisten(socket, 'ice-candidate', callback)
}

export const onTransferComplete = (
  socket: Socket,
  callback: (data: TransferCompleteEvent) => void,
): void => {
  listen(socket, 'transfer-complete', parseTransferCompleteEvent, callback)
}

export const offTransferComplete = (
  socket: Socket,
  callback: (data: TransferCompleteEvent) => void,
): void => {
  unlisten(socket, 'transfer-complete', callback)
}

export const onTransferError = (
  socket: Socket,
  callback: (data: TransferErrorEvent) => void,
): void => {
  listen(socket, 'transfer-error', parseTransferErrorEvent, callback)
}

export const offTransferError = (
  socket: Socket,
  callback: (data: TransferErrorEvent) => void,
): void => {
  unlisten(socket, 'transfer-error', callback)
}

export const onPeerJoined = (socket: Socket, callback: () => void): void => {
  socket.on('peer-joined', callback)
}

export const offPeerJoined = (socket: Socket, callback: () => void): void => {
  socket.off('peer-joined', callback)
}

export const onPeerLeft = (socket: Socket, callback: () => void): void => {
  socket.on('peer-left', callback)
}

export const offPeerLeft = (socket: Socket, callback: () => void): void => {
  socket.off('peer-left', callback)
}
