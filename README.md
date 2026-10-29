# Via

Private, browser-to-browser file sharing for your home network.

**Version 1.0.0** · [Release notes](CHANGELOG.md) · [GPL-3.0-only](LICENSE)

---

## Overview

Via lets anyone on your Wi‑Fi send a file to anyone else on it, from any browser, with nothing to install. Pick a file, share the link, and the file goes **directly from one device to the other** over an encrypted WebRTC connection. It never passes through a server and never leaves your home.

You run Via yourself, in Docker, on one computer that stays on. Everyone at home opens one address, such as `https://yourname-via.duckdns.org`, and gets a real HTTPS page with a lock icon and no certificate warnings, the same way Plex works on a home network.

**What you get**

- **Direct transfers:** files stream peer to peer with no fixed size cap, straight into the file you pick, with resume after a dropped connection and a checksum check at the end.
- **End-to-end verification:** each share link carries a secret key that the server never sees. Both browsers prove to each other that they hold it before any data moves, and both screens show the same 6-digit security code.
- **A server that knows little:** it only introduces the two devices. File names are encrypted before it stores them.
- **Home-only:** nothing is opened on your router, so the site doesn't exist outside your network.
- **Locked-down containers:** each part runs isolated, read-only, with no extra privileges and, apart from Caddy, as a non-root user.

The project has two parts, each in its own repository folder:

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite single-page app: the send and receive pages, WebRTC transfer, and end-to-end checks |
| `backend/` | Node.js + Express + Socket.IO signaling server, with Redis for short-lived sessions |
| `docker/`, `docker-compose.yml` | The home-network deployment: Caddy (HTTPS), nginx, the API, Redis, coturn and a DuckDNS updater |

---

## What's new in 1.0.0

- **Transfers resume after a dropped connection** and verify the result with a CRC32 checksum, retrying automatically when it does not match.
- **Direct-to-disk receiving** in Chrome and Edge, with an OPFS or in-memory fallback and a free-space check before the sender starts.
- **A fallback relay is part of the stack.** coturn handles the rare network where two LAN devices cannot connect directly; files stay DTLS-encrypted end to end.
- **Automatic LAN detection.** `./scripts/start.sh` finds the host's address, updates `LAN_IP`, and starts Compose, so the DuckDNS record and relay always point at the right place.
- **Stricter session handling:** role checks for `transfer-start` and `transfer-complete`, receiver-tab reclaim tokens, configurable session lifetimes, and a shortened TTL after completion.
- **A refreshed interface** with an aurora background, a file-details card, clearer progress, and the shared 6-digit security code.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

---

## Requirements

**To run it at home**

- A computer that stays on: macOS, Linux or Windows.
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2 (Docker Desktop on macOS and Windows).
- A free [DuckDNS](https://www.duckdns.org) account. It provides the name and the certificate; see [How It Works](#how-it-works).
- A router where you can reserve a fixed IP for that computer (a DHCP reservation).
- Internet access for the initial certificate and for renewal about every 60 days. Transfers themselves stay on your Wi‑Fi.

**Browsers that can use it**

Any current Chrome, Edge, Firefox or Safari can send and receive. Chrome and Edge save straight to a file you choose (the File System Access API); Safari and Firefox store the file temporarily and offer it as a download.

**To develop it**

- Node.js 24 (the backend and the Docker images use 24; the frontend also builds on 22).
- Docker, for the Redis and coturn containers used by the backend's integration tests.
- Playwright's Chromium for the frontend's end-to-end tests: `npx playwright install chromium`.

---

## Getting Started

### 1. Give the host computer a fixed home IP

`./scripts/start.sh` detects this computer's LAN address automatically and writes it to `LAN_IP` in `.env` before every start, so the DuckDNS record and the TURN relay always use the current address.

A **DHCP reservation** (also called a "static lease" or "address reservation") in your router's admin page is still recommended, so the address is stable instead of merely corrected on each start.

### 2. Create a free DuckDNS subdomain

1. Go to https://www.duckdns.org and sign in with any of the buttons at the top (GitHub, Google, …). The first sign-in creates the account. It's free and needs no card.
2. Copy the **token** shown at the top of the page. Keep it private: whoever has it controls your name.
3. Under **domains**, type a name in `sub domain` (lowercase letters, digits, `-`) and click **add domain**.
4. DuckDNS fills the new row's `current ip` with your **public** internet IP. **Replace it with the home IP from step 1** and click **update ip**.
5. Check it. This should print your home IP:
   ```bash
   nslookup yourname-via.duckdns.org 8.8.8.8
   ```

### 3. Configure

```bash
cp .env.example .env
```

Fill in the deployment secrets in the root `.env`. Every key is described under [Configuration](#configuration).

For local development, the apps use their own files: copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`.

### 4. Start it

```bash
./scripts/start.sh
```

The first start takes a few minutes. Watch Caddy get the certificate:

```bash
docker compose logs -f caddy
```

Wait for `certificate obtained successfully`, then press Ctrl+C.

### 5. Use it

On any phone or laptop **on the same Wi‑Fi**, open `https://yourname-via.duckdns.org`.

1. **Send:** pick a file, then press **Copy Link**.
2. Share the **whole** link with the person receiving. The part after `#k=` is the security key; a link without it won't open.
3. **Receive:** open the link and press **Download**. Both screens show the same security code once the devices have verified each other.

---

## Configuration

### Root `.env` (read by `docker-compose.yml`)

Deployment secrets only.

| Key | Value |
|---|---|
| `DUCKDNS_DOMAIN` | The subdomain only, e.g. `yourname-via` |
| `VIA_HOST` | The full name, e.g. `yourname-via.duckdns.org` |
| `DUCKDNS_TOKEN` | Your DuckDNS token |
| `LAN_IP` | The host's LAN IP. `scripts/start.sh` detects and writes it; override with `VIA_LAN_IP=…` |
| `REDIS_PASSWORD` | A long random string, e.g. the output of `openssl rand -hex 32` |
| `TURN_SECRET` | Another long random string, shared by the API and coturn |

Never commit or share `.env`. It's already listed in `.gitignore` and `.dockerignore`.

### `backend/.env` and `frontend/.env` (local development only)

These are read by `npm run dev` in each app and are not used by Docker Compose. Start from the matching `.env.example`. The frontend only sees variables prefixed with `VITE_`.

### Backend environment (set in `docker-compose.yml`)

You don't normally need to change these for a home deployment.

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | *(required)* | Redis connection, including its password |
| `CLIENT_ORIGIN` | *(empty)* | Comma-separated allowed browser origins. If empty, production accepts only the site's own origin |
| `TRUSTED_PROXIES` | `127.0.0.1/32,::1` | Addresses allowed to report the client IP (`X-Real-IP`): IPv4 CIDRs, single IPs, or `::1` |
| `MAX_SOCKETS_PER_IP` | `20` | Concurrent connections allowed from one client address |
| `STUN_URLS` | Google STUN | STUN servers handed to browsers. Compose points this at coturn (`stun:$VIA_HOST:3478`) so LAN discovery stays local |
| `TURN_URLS`, `TURN_SECRET` | *(unset)* | TURN relay URLs and the shared secret used to sign short-lived credentials. Compose sets both to the coturn service |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | `debug` adds per-message signaling logs |
| `SESSION_TTL_SECONDS` | `600` | Initial session lifetime |
| `REFRESH_SESSION_TTL_SECONDS` | `1800` | Lifetime granted when a peer joins or the session refreshes |
| `SESSION_MAX_LIFETIME_SECONDS` | `86400` | Absolute cap on a session's age |
| `SESSION_EXPIRY_WARNING_SECONDS` | `30` | How long before expiry the server warns clients; `0` disables it |
| `COMPLETED_SESSION_TTL_SECONDS` | `30` | Window both peers get to see a completed transfer before the session closes |
| `RECOVERY_WINDOW_SECONDS` | `120` | How long a dropped socket may recover before cleanup |
| `MAX_ACTIVE_SESSIONS_PER_PEER` | `1` | Sessions one connection may own |
| `MAX_FILE_SIZE_BYTES` | `0` | Largest announced file size; `0` means no server-side cap |

### Frontend build arguments

| Argument | Default | Purpose |
|---|---|---|
| `VITE_SOCKET_SERVER_URL` | *(empty, meaning same origin)* | Signaling server URL. Leave empty when nginx serves both |
| `VITE_API_BASE_URL` | *(derived)* | REST base for `/api/v1` |
| `VITE_ERROR_REPORTING_URL` | *(unset)* | Optional endpoint for anonymous error reports. If you set it to another host, also allow that host in the CSP in `docker/web.nginx.conf` |
| `VITE_MAX_RECOVERY_ATTEMPTS` | `2` | How many times a broken transfer is retried |

---

## How It Works

### Reaching the site: a public name that points home

Other devices need two things: **a name they can resolve** and **a certificate they already trust**. Via needs HTTPS, because without it browsers disable the APIs it uses to save large files and copy links.

- `something.localhost` won't work: on every device it means "this device".
- `something.local`, or a name set up only in your router, can't get a trusted certificate, so you'd have to install one on every phone.

So Via uses the same approach as Plex:

1. A **DuckDNS** name is set in public DNS to your computer's **home IP**.
2. **Caddy** proves to **Let's Encrypt**, through DNS, that you control the name and gets a real certificate. It never needs an open port.
3. Every device looks up the name, gets your home IP, and connects over Wi‑Fi.

Anyone outside who looks up the name gets a private IP that leads nowhere.

### A transfer, step by step

```
 Sender's browser                    Server                     Receiver's browser
 ────────────────                    ──────                     ──────────────────
 create session  ─────────────────▶  session in Redis
 key K (stays in the #fragment)
 encrypt name with K ─────────────▶  stores ciphertext
 share link …/receive/<id>#k=K  ─────────── (by hand) ──────────▶ open link
                                     join  ◀──────────────────── join session
 offer / ICE  ◀──────────────────▶   relays only  ◀────────────▶ answer / ICE
 ═════════════ direct, encrypted WebRTC data channel (DTLS) ═════════════
 auth: HMAC(K, role, both fingerprints) ◀──────────▶ auth: same, verified
 security code 123 456                               security code 123 456
 file bytes  ═══════════════════════════════════════▶ CRC-checked, saved
```

- **Signaling:** the backend's Socket.IO server pairs the two browsers and passes connection details between them. Sessions live in Redis and expire on their own.
- **Fallback relay:** if the two devices cannot reach each other directly (AP isolation, blocked mDNS, VPN), ICE falls back to the LAN coturn. It forwards the already-DTLS-encrypted packets, so the server still never sees a file's name or contents.
- **Verification:** before anything else is accepted on the data channel, each side sends an HMAC that only the key holder can compute. It covers both sides' DTLS certificate fingerprints, so if anything relayed a substituted connection, the values don't match and the transfer stops.
- **Transfer:** the file is sent in chunks with back-pressure. The receiver checks a CRC32 at the end. Chrome/Edge write straight to the file you pick; Safari/Firefox store it temporarily (OPFS, or memory as a last resort) and offer it as a download. Interrupted transfers resume from the last confirmed byte.

### The containers

```
 LAN ──443──▶ caddy ──edge──▶ web ──app──▶ api ──data──▶ redis
              (TLS)         (nginx +     (signaling)    (sessions)
                             frontend)          │
 LAN ──3478──▶ coturn ◀──── edge ───────────────┘
              (fallback relay; the API only mints its credentials)
```

`app` and `data` are internal networks with no route out: the API and Redis can't reach the internet, and only the API can reach Redis. coturn is only the fallback when two LAN devices cannot connect directly; a small `ddns` container keeps the DuckDNS name pointed at your home IP.

---

## Deployment

### Running and updating

```bash
docker compose up -d --build      # start, or rebuild after changes
```
```bash
docker compose ps                 # every service should be "healthy" or "Up"
```
```bash
docker compose logs -f api        # or caddy, web, redis, ddns
```
```bash
docker compose down               # stop
```

The certificate is kept in a Docker volume, so rebuilding doesn't request a new one. There's no data to back up: sessions are temporary and Redis doesn't write to disk.

### Services

| Service | Image | Runs as | Notes |
|---|---|---|---|
| `caddy` | Caddy 2.10 + DuckDNS plugin | root, with only `NET_BIND_SERVICE` | Publishes 80 and 443; renews the certificate automatically |
| `web` | nginx-unprivileged + the built frontend | uid 101 | Serves the app and proxies `/api` and `/socket.io` to `api` |
| `api` | Node 24 (production dependencies only) | uid 1000 | Signaling server, no internet access |
| `redis` | Redis 7.4 | uid 999 | Password required, no persistence, internal network only |
| `coturn` | coturn 4.6 | uid 65534, with only `NET_BIND_SERVICE` | Fallback relay for direct-connection failures; cannot reach the Docker networks, loopback or link-local space |
| `ddns` | Alpine | uid 65534 | Re-pins the DuckDNS record to `LAN_IP` every hour |

Every service has a read-only filesystem, can't gain privileges, and has memory and process limits; all but caddy and coturn drop every Linux capability.

### Host computer settings

- **Firewall:** allow incoming connections for Docker on ports 80, 443, 3478 (TCP and UDP) and UDP 49300-49340 (the relay range).
- **Sleep:** stop the computer sleeping, or the site disappears.
- **Auto-start:** set Docker to start at login. The containers restart on their own (`restart: unless-stopped`).
- **Don't forward any ports** on your router. Via is designed to stay inside your home network.

### Single-container variant

The root `Dockerfile` (with `docker/entrypoint.sh` and `docker/nginx.conf`) builds everything into one image, with an optional coturn relay (`TURN_ENABLED=true`). `docker-compose.yml` doesn't use it. The split stack above is the supported, hardened deployment.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The name resolves on mobile data but not on Wi‑Fi | Your router has **DNS rebinding protection**, which blocks public names that point at home IPs. Add `duckdns.org` to its exceptions, or use a public DNS server on the device |
| A device uses a privacy DNS or VPN (Mullvad, NextDNS, AdGuard, Pi-hole…) and the name doesn't resolve | Many of these block answers that point at home IPs. Allow the name in that service, or turn the filter off on your home network |
| Devices can't reach each other or the host | Turn off **AP / client isolation** on the Wi‑Fi. Guest networks usually have it on. If they still can't, check `docker compose ps coturn` is healthy and that ports 3478 and UDP 49300-49340 reach the host |
| Metadata arrives but the file never starts | The direct path failed and the relay isn't reachable. Confirm `TURN_SECRET` is set in `.env`, `docker compose logs coturn` shows no auth errors, and the firewall allows the TURN ports |
| Caddy's log shows DNS or ACME errors | Check `DUCKDNS_TOKEN` and `DUCKDNS_DOMAIN` in `.env`, then run `docker compose restart caddy` |
| The site stopped working after the router rebooted | The host got a new IP. Add the DHCP reservation, update `LAN_IP`, then run `docker compose up -d` |
| "This link is missing its security key" | The link was shortened or cut off. Share the complete link, including the part after `#k=` |
| "Security check failed" | The two browsers couldn't verify each other: a wrong or edited link, or something in between. Start a new transfer with a fresh link |
| "too many requests" or HTTP 429 | A client sent far more than normal use. Wait a moment and retry. On Docker Desktop, every device may appear as one address, so the limits are shared per household |
| Receiving fails on one browser | Chrome and Edge save directly. Browsers without the File System Access API fall back to OPFS, or to memory for files under 512 MB. Use Chrome or Edge for large files |

---

## Tests & Scripts

### Backend (`backend/`)

| Command | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run with auto-reload (nodemon) |
| `npm test` | Build, then run the smoke checks (`scripts/smoke.mjs`); no services needed |
| `npm run db:up` | Start the test Redis and coturn (`backend/docker-compose.yml`) |
| `npm run test:integration` | Integration tests against the real server, Redis and coturn (needs `db:up`) |
| `npm run db:down` | Stop the test services |
| `npm run format` / `format:check` | Prettier |

The integration suites cover sessions, origin checks, session integrity, payload limits, rate limits, expiry, ICE/TURN credentials and the relay itself.

### Frontend (`frontend/`)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest): protocol, crypto and verification, server-event parsing, file sink, formatting |
| `npm run test:e2e` | Playwright end-to-end tests against a mock signaling server, including transfer, resume, checksum recovery and an impostor without the key |
| `npm run test:e2e:backend` | The real-backend end-to-end test (start the backend on `127.0.0.1:3000` first) |

### Whole stack (project root)

| Command | What it does |
|---|---|
| `docker compose config --quiet` | Validate the compose file and `.env` |
| `./scripts/start.sh` | Detect `LAN_IP`, update `.env`, build and start everything |
| `docker compose up -d --build` | Build and start everything using the current `.env` |

Both repositories run CI on every push and pull request: dependency audit, formatting or lint, unit and integration or end-to-end tests, and a container build. Dependabot keeps npm packages, Docker images and GitHub Actions current.

---

## Security

**What the server can see:** that a session exists, the file's size, and the two browsers' connection details. **What it can't:** the file's contents, its name or type, or the key in the link.

- **Files never touch the server.** They travel over a direct WebRTC connection, encrypted with DTLS.
- **The link key stays private.** It lives in the URL fragment (`#k=…`), which browsers never send to any server.
- **The peers verify each other.** Each side proves it holds the key and sees the same connection (an HMAC over both DTLS fingerprints). A man in the middle, even a compromised server, fails the check and gets nothing.
- **File details are encrypted.** The name and type are encrypted with AES-GCM using the link key before the server stores them.
- **Neither side trusts the other blindly.**
  - The backend validates every message, requires server-issued session IDs, enforces sender and receiver roles, caps every field's size, and rate-limits each connection and client address.
  - The frontend validates every message from the server and from the other browser, and downloads HTML, SVG and script files as plain files instead of opening them.
- **Browser protections:**
  - a strict Content-Security-Policy (the page can only connect to its own address);
  - HSTS;
  - no cross-site cookies or credentials;
  - foreign origins are refused, including for WebSocket connections.
- **The deployment is isolated:** separate least-privilege containers, internal networks, a password-protected Redis with no persistence, and nothing exposed past your router.

**Reporting a vulnerability:** please don't open a public issue. Contact the maintainer privately, with steps to reproduce.

---

## Languages Used

| Language | Where |
|---|---|
| **TypeScript** | Backend server and frontend app |
| **TSX (React)** | Frontend user interface |
| **JavaScript (ES modules)** | Test suites, smoke checks, end-to-end tests and the mock server |
| **Lua** | Atomic session operations inside Redis |
| **CSS (Tailwind CSS)** | Styling |
| **HTML** | App shell |
| **Shell** | Container entrypoint |
| **YAML, Dockerfile, nginx and Caddyfile config** | Deployment and CI |

---

## License

Via is free software, licensed under the **GNU General Public License v3.0** (SPDX: `GPL-3.0-only`), for both the frontend and the backend. You may use, study, share and modify it. If you distribute a modified version, you must release it under the same licence. See [`LICENSE`](LICENSE) for the full text (each of `backend/` and `frontend/` carries the same file), or https://www.gnu.org/licenses/gpl-3.0.

---

## About

Via started from a simple idea: sending a file to someone in the same room shouldn't mean uploading it to a stranger's server. It keeps files where they belong, between the two people sharing them, on the network they already share.

---

## Acknowledgments

Made proudly in **Mumbai** by **Harsh Sanket**.

This version was built for production with **Claude Opus 5.5**.

Built on the shoulders of excellent open-source projects and services: [React](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com), [Socket.IO](https://socket.io), [Express](https://expressjs.com), [Redis](https://redis.io), [Caddy](https://caddyserver.com), [nginx](https://nginx.org), [coturn](https://github.com/coturn/coturn), [Let's Encrypt](https://letsencrypt.org), [DuckDNS](https://www.duckdns.org), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) and [Docker](https://www.docker.com).

---

<p align="center"><em>a <strong>Harsh Sanket</strong> production</em></p>
