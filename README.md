# Via

Private, browser-to-browser file sharing for your home network.

**Version 1.1.0** · [Setup guide](SETUP.md) · [Features](FEATURES.md) · [Release notes](CHANGELOG.md) · [GPL-3.0-only](LICENSE)

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

The project has three parts:

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite single-page app: the send and receive pages, WebRTC transfer, and end-to-end checks |
| `backend/` | Node.js + Express + Socket.IO signaling server, with Redis for short-lived sessions |
| `docker/`, `docker-compose.yml` | The home-network deployment: Caddy (HTTPS), nginx, the API, Redis, coturn and a DuckDNS updater |

---

## What's new in 1.1.0

- **Short receive links.** Senders now share a four-digit link such as `https://host/1234#k=…`; the server never sees the key.
- **Host-only admin console** at `http://127.0.0.1:8081/config` for short-link mode/length, session TTLs, limits and STUN/TURN URLs.
- **Rebuilt send and receive pages** with a three-step tracker and a unified file card.
- **Dependencies refreshed** to latest releases; backend dev server runs on `tsx watch`.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

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

- Node.js 24 (the backend, the frontend and every Docker image use 24).
- Docker, for the Redis and coturn containers used by the backend's integration tests.
- Playwright's Chromium for the frontend's end-to-end tests: `npx playwright install chromium`.

---

## Getting Started

The complete guide — every variable, DuckDNS, Caddy, coturn, local development,
operations and troubleshooting — is in **[SETUP.md](SETUP.md)**. This is the
short version.

### Quick start

1. **Reserve the host's LAN IP.** Add a **DHCP reservation** in your router so
   the address stays stable. `./scripts/start.sh` detects and writes the address
   automatically; `VIA_LAN_IP=…` overrides detection.
2. **Create a free DuckDNS name.** At <https://www.duckdns.org>, copy the token,
   add a subdomain, and point its IP at the host's **LAN IP** (not your public
   IP). Check it with `nslookup yourname-via.duckdns.org 8.8.8.8`.
3. **Configure.** Copy the deployment template and fill in the six required
   values:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   See [Configure the root `.env`](SETUP.md#43-configure-the-root-env) for the
   full template and secret generation commands.

4. **Start it.** The first build takes a few minutes:

   ```bash
   ./scripts/start.sh
   docker compose logs -f caddy   # wait for "certificate obtained successfully"
   ```

5. **Use it.** On any phone or laptop **on the same Wi‑Fi**, open
   `https://yourname-via.duckdns.org`.

   1. **Send:** pick a file, then press **Copy Link**.
   2. Share the **whole** link. The part after `#k=` is the security key; a link
      without it won't open.
   3. **Receive:** open the link and press **Download**. Both screens show the
      same security code once the devices have verified each other.

For local development, the apps use their own files: copy
`backend/.env.example` to `backend/.env` and `frontend/.env.example` to
`frontend/.env`. See [Local development](SETUP.md#49-local-development).

---

## Configuration

All settings live in one of five places:

| Where | Controls | Reference |
|---|---|---|
| Root `.env` | Deployment secrets, DuckDNS, LAN IP, default session lifetimes | [SETUP.md §4.3](SETUP.md#43-configure-the-root-env) |
| Host-only admin page | Short-link mode/length, session TTLs, limits, STUN/TURN URLs, admin credentials | Open `http://127.0.0.1:8081/config` on the host |
| `docker-compose.yml` | Backend runtime defaults, networks, volumes, hardening | [SETUP.md §4.6–4.7](SETUP.md#46-the-compose-stack) |
| `backend/.env` | Backend behavior for local development | [SETUP.md §4.9](SETUP.md#49-local-development) |
| `frontend/.env` / build args | `VITE_*` values baked into the frontend | [SETUP.md §4.8](SETUP.md#48-frontend-build-configuration) |

The six required root `.env` values are:

| Key | Value |
|---|---|
| `DUCKDNS_DOMAIN` | The subdomain only, e.g. `yourname-via` |
| `VIA_HOST` | The full name, e.g. `yourname-via.duckdns.org` |
| `DUCKDNS_TOKEN` | Your DuckDNS token |
| `LAN_IP` | The host's LAN IP; `scripts/start.sh` writes it |
| `REDIS_PASSWORD` | `openssl rand -hex 32` |
| `TURN_SECRET` | A different `openssl rand -hex 32` |

Never commit or share `.env`. It is listed in `.gitignore` and `.dockerignore`.

The admin page is served only on the host loopback
(`http://127.0.0.1:8081/config`); the public Via address returns 404 for it.
The default account is `admin` / `admin`, and it must be changed before any
other setting can be saved. Admin settings persist in the `settings` Docker
volume; secrets such as `TURN_SECRET`, the Redis password and the DuckDNS token
stay in `.env` and are never shown in the browser.

The full variable tables — backend runtime, frontend build args, session
lifetimes, TURN credentials and the legacy single-container variables — are in
[SETUP.md §4.7–4.10](SETUP.md#47-backend-runtime-configuration).

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
 share link …/1234#k=K        ─────────── (by hand) ──────────▶ open link
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
./scripts/start.sh                 # detect LAN_IP, build, start
docker compose ps                  # every service should be "healthy" or "Up"
docker compose logs -f api         # or caddy, web, redis, coturn, ddns
docker compose down                # stop; keeps the certificate volumes
```

The certificate is kept in a Docker volume, so rebuilding doesn't request a new
one. There's no data to back up: sessions are temporary and Redis doesn't write
to disk. For updates, network changes, secret rotation and backups, see the
[operations runbook](SETUP.md#operations).

### Services

| Service | Image | Runs as | Notes |
|---|---|---|---|
| `caddy` | Caddy 2.10 + DuckDNS plugin | root, with only `NET_BIND_SERVICE` | Publishes 80 and 443; renews the certificate automatically |
| `web` | nginx-unprivileged + the built frontend | uid 101 | Serves the app and proxies `/api` and `/socket.io` to `api` |
| `api` | Node 24 (production dependencies only) | uid 1000 | Signaling server, no internet access |
| `redis` | Redis 7.4 | uid 999 | Password required, no persistence, internal network only |
| `coturn` | coturn 4.6 | uid 65534, with only `NET_BIND_SERVICE` | Fallback relay for direct-connection failures; cannot reach the Docker networks, loopback or link-local space |
| `ddns` | Alpine | uid 65534 | Re-pins the DuckDNS record to `LAN_IP` every hour |

Every service has a read-only filesystem, can't gain privileges, and has memory
and process limits; all but caddy and coturn drop every Linux capability. The
full topology, subnets and volumes are in
[SETUP.md §4.6](SETUP.md#46-the-compose-stack).

### Host computer settings

- **Firewall:** allow incoming connections for Docker on ports 80, 443, 3478
  (TCP and UDP) and UDP 49300-49340 (the relay range).
- **Sleep:** stop the computer sleeping, or the site disappears.
- **Auto-start:** set Docker to start at login. The containers restart on their
  own (`restart: unless-stopped`).
- **Don't forward any ports** on your router. Via is designed to stay inside
  your home network.

### Single-container variant

The root `Dockerfile` (with `docker/entrypoint.sh` and `docker/nginx.conf`)
builds everything into one image, with an optional coturn relay
(`TURN_ENABLED=true`). `docker-compose.yml` doesn't use it, and it does not
include Caddy. The split stack above is the supported, hardened deployment. See
[SETUP.md §4.10](SETUP.md#410-single-container-variant) for its variables and
run command.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The name resolves on mobile data but not on Wi‑Fi | Your router has **DNS rebinding protection**, which blocks public names that point at home IPs. Add `duckdns.org` to its exceptions, or use a public DNS server on the device |
| A device uses a privacy DNS or VPN (Mullvad, NextDNS, AdGuard, Pi-hole…) and the name doesn't resolve | Many of these block answers that point at home IPs. Allow the name in that service, or turn the filter off on your home network |
| Devices can't reach each other or the host | Turn off **AP / client isolation** on the Wi‑Fi, then check `docker compose ps coturn` and the TURN ports |
| Caddy's log shows DNS or ACME errors | Check `DUCKDNS_TOKEN` and `DUCKDNS_DOMAIN` in `.env`, then run `docker compose restart caddy` |
| The site stopped working after the router rebooted | The host got a new IP. Run `./scripts/start.sh`; add a DHCP reservation |
| "too many requests" or HTTP 429 | A client sent far more than normal use. Wait and retry. On Docker Desktop, every device may appear as one address, so limits are shared per household |

The full matrix — ACME, TURN, browser storage, CSP, partial saves and more — is
in [SETUP.md §Troubleshooting](SETUP.md#troubleshooting).

---

## Tests & Scripts

### Backend (`backend/`)

| Command | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run with auto-reload (tsx watch) |
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

The project includes CI workflows (`.github/workflows/backend.yml`, `frontend.yml`) and Dependabot configuration for both apps: dependency audit, formatting or lint, unit and integration or end-to-end tests, and a container build.

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
