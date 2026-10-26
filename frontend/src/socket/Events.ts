import { Socket } from 'socket.io-client'
import {
  parseFileMetadataEvent,
  parseSessionErrorEvent,
  parseSessionExpiredEvent,
  parseSessionExpiringEvent,
  parseSessionTtl,
} from '../lib/server-events'
import { listen, unlisten } from './guard'
import type {
  SessionErrorEvent,
  SessionExpiredEvent,
  SessionExpiringEvent,
  SessionTTL,
  FileMetadataEvent,
} from './Types'

// ─── Connection ───────────────────────────────────────────────────────────────

export const onConnect = (socket: Socket, callback: () => void): void => {
  socket.on('connect', callback)
}

export const offConnect = (socket: Socket, callback: () => void): void => {
  socket.off('connect', callback)
}

export const onDisconnect = (socket: Socket, callback: () => void): void => {
  socket.on('disconnect', callback)
}

export const offDisconnect = (socket: Socket, callback: () => void): void => {
  socket.off('disconnect', callback)
}

// ─── Session TTL ──────────────────────────────────────────────────────────────

export const onTTL = (
  socket: Socket,
  callback: (data: SessionTTL) => void,
): void => {
  listen(socket, 'session:ttl', parseSessionTtl, callback)
}

export const offTTL = (
  socket: Socket,
  callback: (data: SessionTTL) => void,
): void => {
  unlisten(socket, 'session:ttl', callback)
}

/** Pushed by the server before expiry; preferred over polling. */
export const onSessionExpiring = (
  socket: Socket,
  callback: (data: SessionExpiringEvent) => void,
): void => {
  listen(socket, 'session:expiring', parseSessionExpiringEvent, callback)
}

export const offSessionExpiring = (
  socket: Socket,
  callback: (data: SessionExpiringEvent) => void,
): void => {
  unlisten(socket, 'session:expiring', callback)
}

export const onSessionExpired = (
  socket: Socket,
  callback: (data: SessionExpiredEvent) => void,
): void => {
  listen(socket, 'session:expired', parseSessionExpiredEvent, callback)
}

export const offSessionExpired = (
  socket: Socket,
  callback: (data: SessionExpiredEvent) => void,
): void => {
  unlisten(socket, 'session:expired', callback)
}

// ─── Session Error ────────────────────────────────────────────────────────────

export const onSessionError = (
  socket: Socket,
  callback: (data: SessionErrorEvent) => void,
): void => {
  listen(socket, 'session:error', parseSessionErrorEvent, callback)
}

export const offSessionError = (
  socket: Socket,
  callback: (data: SessionErrorEvent) => void,
): void => {
  unlisten(socket, 'session:error', callback)
}

// ─── File Metadata ────────────────────────────────────────────────────────────

export const onFileMetadata = (
  socket: Socket,
  callback: (data: FileMetadataEvent) => void,
): void => {
  listen(socket, 'file-metadata', parseFileMetadataEvent, callback)
}

export const offFileMetadata = (
  socket: Socket,
  callback: (data: FileMetadataEvent) => void,
): void => {
  unlisten(socket, 'file-metadata', callback)
}
