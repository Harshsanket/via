# VIA — File Sharing App

**Current Version:** v1.0.0

**Codename:** Hatchling 🐣

**Catch the First Flight Soon**

VIA is a browser-to-browser file sharing app made for everyone — open, simple,
and built to just work. Powered by Socket.IO and WebRTC, it runs across any
browser and platform, delivering fast, secure peer-to-peer transfers for files
of any type or size. No barriers, no complexity — sharing things should be as
easy as sending a link.

This repository is the **signaling server**: it creates and joins sessions,
forwards WebRTC offers/answers/ICE candidates between the two peers, tracks
session lifetime in Redis, and mints short-lived TURN credentials so transfers
can get through strict networks. The actual file bytes never touch this server —
they go peer to peer over WebRTC.

This is the first stable release. If you run into a bug, have an idea that could make it better, or want to contribute, feel free to open an issue or reach out. Every bit of support genuinely helps move the project forward.

_Code built and crafted by a human, with love._

---

### Stack

- **Node.js + TypeScript + Express 5** — HTTP API and process lifecycle
- **Socket.IO** — signaling transport, with connection state recovery
- **Redis** — the only datastore: sessions, peer mappings, TTLs
- **coturn** (development only, via docker-compose) — relaying for ICE tests
- **Pino** — structured logging, with credentials redacted

---

### Running locally

Requirements: Node 24+, Docker.

```bash
npm ci
cp .env.example .env        # then edit the values
npm run db:up               # Redis + coturn, waits until healthy
npm run dev                 # http://localhost:3000
```

Required environment variables (the server refuses to boot without them):

| Variable        | Example                                    | Purpose                                                   |
| --------------- | ------------------------------------------ | --------------------------------------------------------- |
| `REDIS_URL`     | `redis://127.0.0.1:6379`                   | Session store                                             |
| `CLIENT_ORIGIN` | `http://localhost:5173`                    | CORS allowlist (comma separated; empty = allow any)       |
| `TURN_URLS`     | `turn:turn.example.com:3478?transport=udp` | Relay(s) handed to clients via `/ice-servers`             |
| `TURN_SECRET`   | _(shared with coturn `--use-auth-secret`)_ | Signs short-lived TURN credentials; never sent to clients |
| `STUN_URLS`     | `stun:stun.l.google.com:19302`             | Optional override (a public STUN is the default)          |
| `PORT`          | `3000`                                     | Optional                                                  |

Without `TURN_URLS`/`TURN_SECRET` the server still runs, but
`GET /api/v1/ice-servers` answers `503` — transfers will only work on
friendly networks.

---

### Scripts

| Command                     | What it does                                          |
| --------------------------- | ----------------------------------------------------- |
| `npm run dev`               | Start with hot reload                                 |
| `npm run build`             | Compile TypeScript to `dist/`                         |
| `npm start`                 | Run the compiled server                               |
| `npm test`                  | Build + smoke checks (no services needed)             |
| `npm run test:integration`  | Socket tests against real Redis + coturn              |
| `npm run db:up` / `db:down` | Start/stop the local services (`-v` drops the volume) |
| `npm run format`            | Format the repo                                       |

---

### API surface

- `GET /api/v1/health` — `200` when Redis answers, `503` when degraded
- `GET /api/v1/ice-servers?sessionId=…` — STUN + short-lived TURN credentials
  for a live session
- Socket.IO events: `create-session`, `join-session`, `get-ttl`,
  `store-file-metadata`, `get-file-metadata`, `transfer-complete`,
  `transfer-error`, `offer`, `answer`, `ice-candidate`, plus server pushes
  `session:expiring` / `session:expired`

Sessions live in Redis with an idle TTL and an absolute 24 h lifetime cap;
joining is atomic, so two peers racing for the last slot cannot both win.

---

### Thanks to the tools that made this possible

A huge shoutout to the amazing tools and communities that made VIA possible —
**Socket.IO** and **WebRTC** for being the backbone of everything (this
literally wouldn't exist without them), **Vercel** for seamless deployment,
**Tailwind CSS** and **shadcn/ui** for making it look good, and **Redis** for
handling the data. Also a special thanks to **Claude** and **ChatGPT** for being
the coding companions throughout the build.

---

© 2026 — a **Harsh Sanket** production.
