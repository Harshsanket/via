# Via

Via is a free, open-source, peer-to-peer file transfer app. It lets two people send files directly between their browsers over an encrypted WebRTC connection — no accounts, no cloud upload, and no file storage on a server.

The frontend is built with React, TypeScript, Tailwind CSS, and Vite. A small signaling server handles session setup and connection negotiation; the file bytes never pass through it.

## What It Does

- Creates a short-lived session and a shareable receive link.
- Connects two browsers directly over an encrypted WebRTC data channel.
- Starts the sender automatically when the receiver clicks **Download**.
- Saves directly to the receiver's chosen file in Chromium/Edge using the File System Access API.
- Falls back to OPFS/memory streaming and an automatic download in other browsers.
- Transfers files in chunks with backpressure, live speed, ETA, pause, and cancel controls.
- Resumes an interrupted transfer after the data channel reconnects, from the receiver's confirmed byte offset.
- Retries automatically when the receiver's CRC32 checksum does not match.
- Verifies the received byte count and CRC32 checksum before saving.
- Fetches TURN/STUN credentials from the signaling server, with public STUN as a fallback and a visible warning when TURN is unavailable.
- Shows session expiry countdowns, signaling reconnects, and a retry banner when the backend is unreachable.
- Includes a light-only theme, keyboard-accessible controls, reduced-motion support, and screen-reader progress announcements.
- Works without accounts, installs, or file uploads to the server.

## The Problem It Solves

Most file-sharing tools require uploading the file to a third-party cloud first. That adds waiting time, size limits, account requirements, and a copy of the file on someone else's infrastructure.

Via removes that middle step. The file goes from sender to receiver over a direct WebRTC connection, so transfers can start immediately, avoid cloud storage limits, and keep file contents off the signaling server. The server only coordinates the connection and stores temporary session metadata (name, type, size) in Redis until the session expires.

## How It Works

```text
Sender                        Signaling server                     Receiver
  | ---- create-session -----------> |                                  |
  | <------- sessionId ------------- |                                  |
  | ---- store-file-metadata -------> | (Redis: name/type/size)          |
  |                                  | <--------- join-session --------- |
  | <---------------- peer-joined --- |                                  |
  | ---- offer ---------------------> | ---------- offer --------------> |
  | <------------------------------- answer ---------------------------- |
  | <======== ICE candidates exchanged via signaling =================> |
  | <============= encrypted WebRTC data channel ====================> |
  | <------------------------ request-transfer ----------------------- |
  | ========================= file chunks ===========================> |
  |                                  | <------- transfer-complete ------ |
  | <------------------- transfer-complete --------------------------- |
```

1. The sender creates a session and shares the resulting link.
2. Socket.IO carries session events, SDP offers/answers, and ICE candidates.
3. The browsers establish a direct WebRTC data channel.
4. The receiver clicks **Download**. Chromium/Edge opens a save dialog; other browsers use temporary storage.
5. The receiver sends `request-transfer` over the data channel.
6. The sender transmits the file in 64 KB chunks, pausing when the send buffer fills.
7. Chunks stream directly to the chosen file, or to OPFS/memory when direct save is unavailable.
8. If the data channel drops, both peers renegotiate it and resume from the receiver's last confirmed byte.
9. The receiver checks the byte count and CRC32 checksum, then emits `transfer-complete`.
10. On a checksum failure, the receiver can request a fresh copy without restarting the session.
11. Direct saves are already on disk; fallback mode auto-downloads and keeps a Save button as a backup.

## Setup

### Requirements

- Node.js 20+ (developed on Node 24; CI uses Node 22)
- npm 10+
- A running [Via signaling server](https://github.com/Harshsanket/via)
- A browser with WebRTC support; Chromium-based browsers also support OPFS streaming
- HTTPS in production (required by WebRTC, clipboard, and most browsers)

### 1. Start the backend

Follow the setup instructions in [Harshsanket/via](https://github.com/Harshsanket/via). The backend provides the Socket.IO signaling server, Redis-backed sessions, and the optional TURN credential endpoint. By default the frontend expects it at:

```text
http://localhost:3000
```

### 2. Install the frontend

```bash
git clone https://github.com/Harshsanket/via-frontend.git
cd via-frontend
npm install
cp .env.example .env
```

### 3. Configure the environment

Vite only exposes variables prefixed with `VITE_`.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SOCKET_SERVER_URL` | No | Socket.IO signaling server URL. Defaults to the page origin when unset, e.g. `http://localhost:3000`. |
| `VITE_API_BASE_URL` | No | REST base for ICE/TURN credentials. Defaults to `<VITE_SOCKET_SERVER_URL origin>/api/v1`. |
| `VITE_ERROR_REPORTING_URL` | No | Opt-in POST endpoint for privacy-preserving error events and Web Vitals. No file names or file contents are sent. |

Local example:

```dotenv
VITE_SOCKET_SERVER_URL=http://localhost:3000
```

The URL is validated at startup. An invalid value falls back to the page origin and shows a warning in the app.

### 4. Run it

```bash
npm run dev
```

Open the printed local URL, create a session on `/send`, and open the receive link in a second browser or device.

### Production build

```bash
npm run build
npm run preview
```

Serve `dist/` over HTTPS and configure SPA fallback so routes such as `/receive/:sessionId` return `index.html`.

## Docker

The frontend is packaged as a multi-stage image: Node builds the app, then unprivileged Nginx serves the static bundle with SPA fallback, caching, security headers, and a health endpoint.

```bash
cp .env.example .env
# set VITE_SOCKET_SERVER_URL to your Via backend
docker compose build
docker compose up -d
```

Open <http://localhost:8080>. The Via signaling backend runs separately; this compose file does not start it. Set the backend URL to something the browser can reach, and add the frontend origin to the backend's CORS allowlist.

`VITE_*` values are compiled into the bundle at image build time, so rebuild after changing them. To use another host port:

```bash
VIA_FRONTEND_PORT=3001 docker compose up -d
```

Build and run without Compose:

```bash
docker build \
  --build-arg VITE_SOCKET_SERVER_URL=http://localhost:3000 \
  -t via-frontend:local .

docker run --rm -p 8080:8080 via-frontend:local
```

See [`docs/DOCKER.md`](docs/DOCKER.md) for architecture, configuration, security notes, and troubleshooting.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript project checks |
| `npm test` | Run Vitest unit tests once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run Playwright end-to-end tests against a mock signaling server |
| `npm run test:e2e:backend` | Run the Playwright transfer test against a real backend (default `http://127.0.0.1:3000`) |
| `npm run docker:build` | Build the production Docker image |
| `npm run docker:up` | Start the frontend container |
| `npm run docker:logs` | Follow container logs |
| `npm run docker:down` | Stop and remove the container |

CI runs `npm ci`, a high-severity dependency audit, lint, unit tests, a production build, Playwright end-to-end tests, and a Docker image build/smoke test on pushes to `main` and pull requests. Dependabot keeps npm and GitHub Actions dependencies current.

Unit tests cover the transfer protocol guards, CRC32 state/resume, direct/OPFS/memory file sinks, rate/ETA calculation, formatting, and validation. Playwright verifies the real WebRTC flow in Chromium against a mock signaling server: receiver-initiated download, direct save, automatic fallback download, checksum retry, mid-transfer channel recovery, and the backend-offline banner.

To run the transfer test against the real signaling backend, start Via with Redis and TURN, allow `http://127.0.0.1:4173` in `CLIENT_ORIGIN`, then run:

```bash
npm run test:e2e:backend
```

## Project Structure

```text
src/
  App.tsx                  # Routes and layout
  main.tsx                 # React entry point
  components/              # Header, footer, banners, progress, error alerts, UI primitives
  hooks/                   # Logger, session TTL, socket status, media query
  lib/                     # Env, CRC32, OPFS sink, ICE, protocol, rate, telemetry, WebRTC
  pages/
    Home.tsx
    NotFound.tsx
    send/                  # Session state hook + presentational view + file dropzone
    receive/               # Session state hook + presentational view
  socket/                  # Socket.IO protocol types, listeners, emitters
e2e/                       # Playwright specs + mock signaling server
Dockerfile                 # Multi-stage production image
docker-compose.yml         # Frontend container orchestration
docker/nginx.conf          # SPA fallback, caching, and security headers
LICENSE                    # GNU GPLv3
```

## Browser Support and Limits

- **Storage:** Chromium/Edge stream directly to a user-chosen file through the File System Access API. Other browsers stream to OPFS, or a memory buffer capped at 512 MB when OPFS is unavailable.
- **Save fallback:** If direct save is unavailable, the verified file downloads automatically. A Save button remains visible if the browser blocks the automatic download.
- **Aborted direct saves:** A cancelled or failed direct save can leave a partial file at the chosen location; the UI reports the failure.
- **TURN:** The app requests ephemeral TURN credentials from the backend. If TURN is not configured, it falls back to public STUN, and symmetric NAT or restrictive firewalls may block the transfer.
- **Resume:** The app renegotiates a dropped data channel and resumes from the receiver's confirmed offset. Recovery is bounded to a 45-second window; after that, start a new transfer.
- **Session key:** The link acts as a bearer secret. Anyone who has it can join while the session is active.
- **Metadata:** The signaling server stores filename, MIME type, and size temporarily. File contents remain peer-to-peer.
- **Integrity:** CRC32 detects corruption and truncation; it is not a cryptographic authenticity guarantee.

## About

Via is a privacy-first file transfer tool built around a simple idea: sharing a file should be as easy as sharing a link, without handing the file to a cloud provider first. It is designed for quick, temporary transfers between people who already know each other, with a clean interface and a small, auditable codebase.

The project is under active development. The signaling backend, TURN configuration, and production deployment live in the related Via server project.

Developed and maintained by **Harsh Sanket**.<br>
**DeepSeek 4.1** was used during development.

## Tech Stack

| Category          | Technologies                                       |
| ----------------- | -------------------------------------------------- |
| Frontend          | React 19, TypeScript, React Router 7               |
| Build tooling     | Vite 7, npm                                        |
| Styling           | Tailwind CSS v4, class-variance-authority, Lucide  |
| File transfer     | WebRTC data channels, Socket.IO client, OPFS, File System Access |
| Integrity         | Incremental CRC32                                  |
| Testing           | Vitest, Playwright                                 |
| Code quality      | ESLint, TypeScript strict mode                     |
| Deployment        | Docker, unprivileged Nginx                         |
| CI / maintenance  | GitHub Actions, Dependabot                         |

## Sponsor

The development of this project and my open-source work on GitHub are sponsored by [**kumarsidd**](https://github.com/kumarsidd).

## License

Released under the GNU General Public License v3.0 — see [`LICENSE`](./LICENSE).

---

Proudly made in Mumbai by Harsh Sanket.

a **Harsh Sanket** production.
