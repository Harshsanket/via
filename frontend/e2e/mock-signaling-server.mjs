import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'

const port = Number(process.env.MOCK_PORT ?? 3100)
const sessionTtlSeconds = 3_600

const sessions = new Map()
const shortCodes = new Map()

const generateShortCode = () => {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const code = String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
    if (!shortCodes.has(code)) return code
  }
  throw new Error('no short codes left')
}

const httpServer = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('ok\n')
    return
  }

  // Like the real server with no relay configured: 503 tells the client to
  // use host candidates only instead of falling back to public STUN.
  if (request.url?.startsWith('/api/v1/ice-servers')) {
    response.writeHead(503, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
    })
    response.end(JSON.stringify({ success: false, message: 'no relay' }))
    return
  }

  response.writeHead(404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ error: 'not found' }))
})

const io = new Server(httpServer, {
  cors: { origin: true },
  maxHttpBufferSize: 1e7,
})

const getSession = (sessionId) => sessions.get(sessionId)

io.on('connection', (socket) => {
  socket.on('create-session', (ack) => {
    const sessionId = randomUUID()
    const shortCode = generateShortCode()
    shortCodes.set(shortCode, sessionId)
    sessions.set(sessionId, {
      sessionId,
      shortCode,
      createdAt: new Date().toISOString(),
      metadata: null,
      peers: new Set([socket.id]),
    })
    socket.join(sessionId)
    socket.data.sessionId = sessionId
    ack?.({ success: true, sessionId, shortCode })
  })

  socket.on('resolve-session', (payload, ack) => {
    const sessionId = shortCodes.get(payload?.shortCode)
    const session = sessionId ? getSession(sessionId) : null
    if (!session) {
      ack?.({ success: false, message: 'session expired or invalid' })
      return
    }
    ack?.({ success: true, sessionId })
  })

  socket.on('join-session', (payload, ack) => {
    const session = getSession(payload?.sessionId)
    if (!session) {
      ack?.({ success: false, message: 'session expired or invalid' })
      return
    }

    session.peers.add(socket.id)
    socket.join(session.sessionId)
    socket.data.sessionId = session.sessionId
    socket.to(session.sessionId).emit('peer-joined')
    ack?.({ success: true, metadata: session.metadata })
  })

  socket.on('store-file-metadata', (payload) => {
    const session = getSession(payload?.sessionId)
    if (!session) return

    session.metadata = {
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
    }

    io.to(session.sessionId).emit('file-metadata', {
      sessionId: session.sessionId,
      success: true,
      metadata: session.metadata,
    })
  })

  socket.on('get-file-metadata', (payload) => {
    const session = getSession(payload?.sessionId)
    if (!session) return
    socket.emit('file-metadata', {
      sessionId: session.sessionId,
      success: true,
      metadata: session.metadata,
    })
  })

  socket.on('get-ttl', (payload) => {
    const session = getSession(payload?.sessionId)
    socket.emit('session:ttl', {
      exists: Boolean(session),
      createdAt: session?.createdAt ?? null,
      ttl: session ? sessionTtlSeconds : null,
    })
  })

  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, (payload) => {
      if (!payload?.sessionId) return
      socket.to(payload.sessionId).emit(event, payload)
    })
  }

  socket.on('transfer-complete', (payload, ack) => {
    const session = getSession(payload?.sessionId)
    if (!session) {
      ack?.({ success: false, message: 'session expired or invalid' })
      return
    }
    if (session.shortCode) shortCodes.delete(session.shortCode)
    socket
      .to(payload.sessionId)
      .emit('transfer-complete', {
        success: true,
        fileName: payload.fileName,
      })
    ack?.({ success: true, message: 'transfer complete' })
  })

  socket.on('transfer-error', (payload, ack) => {
    const session = getSession(payload?.sessionId)
    if (!session) {
      ack?.({ success: false, message: 'session expired or invalid' })
      return
    }
    socket.to(payload.sessionId).emit('transfer-error', { success: true })
    ack?.({ success: true, message: 'transfer error recorded' })
  })

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue
      socket.to(roomId).emit('peer-left')
    }
  })
})

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`mock signaling server listening on http://127.0.0.1:${port}`)
})
