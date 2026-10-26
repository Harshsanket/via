import type { Socket } from 'socket.io-client'

/**
 * Socket listeners that only ever see payloads that passed a parser from
 * lib/server-events.ts. Anything else from the server is dropped.
 *
 * The wrapper per (callback, event) is remembered so the matching `off*`
 * helper can remove exactly the listener its `on*` added.
 */
type Wrapper = (raw: unknown) => void

const wrappers = new WeakMap<object, Map<string, Wrapper>>()

export function listen<T>(
  socket: Socket,
  event: string,
  parse: (raw: unknown) => T | null,
  callback: (data: T) => void,
): void {
  let byEvent = wrappers.get(callback)
  if (!byEvent) {
    byEvent = new Map()
    wrappers.set(callback, byEvent)
  }

  const previous = byEvent.get(event)
  if (previous) socket.off(event, previous)

  const wrapper: Wrapper = (raw) => {
    const data = parse(raw)
    if (data === null) {
      console.warn(`Ignored a malformed "${event}" event from the server`)
      return
    }
    callback(data)
  }

  byEvent.set(event, wrapper)
  socket.on(event, wrapper)
}

export function unlisten(socket: Socket, event: string, callback: object): void {
  const byEvent = wrappers.get(callback)
  const wrapper = byEvent?.get(event)
  if (!wrapper) return
  socket.off(event, wrapper)
  byEvent?.delete(event)
}

/** Wraps an ack callback so it only sees a parsed response. */
export function guardAck<T>(
  parse: (raw: unknown) => T | null,
  fallback: T,
  callback: (data: T) => void,
): (raw: unknown) => void {
  return (raw) => callback(parse(raw) ?? fallback)
}
