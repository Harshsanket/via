# Via setup and configuration

This is the complete setup guide for Via: every configuration file, every
environment variable, and the full path from a clean machine to a working
`https://your-name.duckdns.org`.

If you only want the short version, jump to [Quick start](#quick-start). If you
want the architecture behind the steps, see [How it fits together](#how-it-fits-together).

> **Never commit or share `.env`.** It contains the DuckDNS token, the Redis
> password and the TURN secret. It is already ignored by Git and Docker.

---

## Contents

1. [What you get](#what-you-get)
2. [Before you start](#before-you-start)
3. [Quick start](#quick-start)
4. [Step-by-step setup](#step-by-step-setup)
   - [4.1 Reserve the host's LAN IP](#41-reserve-the-hosts-lan-ip)
   - [4.2 Set up DuckDNS](#42-set-up-duckdns)
   - [4.3 Configure the root `.env`](#43-configure-the-root-env)
   - [4.4 Start and verify](#44-start-and-verify)
   - [4.5 Caddy and TLS](#45-caddy-and-tls)
   - [4.6 The Compose stack](#46-the-compose-stack)
   - [4.7 Backend runtime configuration](#47-backend-runtime-configuration)
   - [4.8 Frontend build configuration](#48-frontend-build-configuration)
   - [4.9 Local development](#49-local-development)
   - [4.10 Single-container variant](#410-single-container-variant)
5. [Operations](#operations)
6. [Troubleshooting](#troubleshooting)
7. [Security checklist](#security-checklist)
8. [Reference](#reference)

---

## What you get

After setup, every phone, tablet and computer on your Wi-Fi can open one name:

```text
https://your-name.duckdns.org
```

The name resolves to the host machine's **private LAN address**, not to the
public internet. Caddy holds a real Let's Encrypt certificate for it, so
browsers show a normal lock icon with no warnings.

```text
LAN ──443──▶ caddy ──edge──▶ web ──app──▶ api ──data──▶ redis
              (TLS)         (nginx +     (signaling)    (sessions)
                             frontend)
LAN ──3478──▶ coturn ◀──── edge
              (fallback relay; the API mints short-lived credentials)
```

Files travel browser-to-browser over an encrypted WebRTC data channel. The
server only pairs the two browsers and stores short-lived session metadata.

**Ports used on the host**

| Port | Protocol | Service | Purpose |
|---|---|---|---|
| 80 | TCP | `caddy` | Redirects HTTP to HTTPS |
| 443 | TCP + UDP | `caddy` | The app over HTTPS/HTTP3 |
| 3478 | TCP + UDP | `coturn` | STUN/TURN fallback relay |
| 49300–49340 | UDP | `coturn` | Relay media range |

Docker publishes these directly. **Do not forward them on your router**; the
site is meant to exist only inside your home network.

---

## Before you start

### The host

- A computer that stays on — macOS, Linux or Windows.
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2
  (Docker Desktop on macOS and Windows).
- A wired or Wi-Fi connection to the same network as the devices that will use
  Via.
- A router where you can create a **DHCP reservation** (a fixed local IP).

### Accounts and names

- A free [DuckDNS](https://www.duckdns.org) account. It provides both the public
  name and the DNS-01 challenge Caddy uses to get a certificate.
- No domain purchase, no port forwarding and no public IP are required.

### Browsers

- **Send:** any current Chrome, Edge, Firefox or Safari.
- **Receive directly to disk:** Chrome or Edge, using the File System Access
  API.
- **Receive elsewhere:** Safari and Firefox store the file temporarily in the
  browser (OPFS, or memory up to 512 MB) and then offer it as a download.
- HTTPS is required in production for WebRTC, the clipboard and the file APIs.

### Windows note

The helper scripts are POSIX shell scripts. Run them from **WSL** or Git Bash.
The Docker commands in this guide work from PowerShell as well.

---

## Quick start

From the project root:

```bash
cp .env.example .env
# edit .env: DUCKDNS_DOMAIN, VIA_HOST, DUCKDNS_TOKEN, REDIS_PASSWORD, TURN_SECRET
./scripts/start.sh
```

Then watch the certificate being issued:

```bash
docker compose logs -f caddy
```

Wait for `certificate obtained successfully`, then open
`https://your-name.duckdns.org` on a device on the same Wi-Fi.

Check the stack:

```bash
docker compose ps
```

`caddy` and `ddns` should show `Up`; the others should show `Up (healthy)`.

If anything fails, continue with the detailed steps below.

---

## Step-by-step setup

### 4.1 Reserve the host's LAN IP

The DuckDNS record and the TURN relay both need a stable LAN address.

1. Find the host's current address:
   - **macOS:** `ipconfig getifaddr en0`
   - **Linux:** `hostname -I`
   - **Windows:** `ipconfig`, then read the IPv4 address.
2. In the router's admin page, add a **DHCP reservation** (static lease) for the
   host's MAC address. This keeps the address stable across reboots.

You do not have to type the address into `.env`: `./scripts/start.sh` detects
it, rewrites the `LAN_IP=` line, and then starts Compose.

Detection only considers physical interfaces (`en*`, `eth*`, `wl*`, `wlan*`)
and private IPv4 ranges, so an active VPN tunnel is not mistaken for the LAN.
If detection picks the wrong interface, override it:

```bash
VIA_LAN_IP=192.168.1.50 ./scripts/start.sh
```

Re-run the script whenever the host changes networks. The `ddns` container
re-asserts the record hourly, but only for the address it started with.

### 4.2 Set up DuckDNS

1. Open <https://www.duckdns.org> and sign in with GitHub, Google, or another
   provider. The first sign-in creates the account; it is free.
2. Copy the **token** shown near the top of the page. Treat it like a password:
   anyone with it can change your DNS records.
3. Under **domains**, type a subdomain label (lowercase letters, digits and
   `-`), for example `via-home`, and click **add domain**.
4. DuckDNS will fill in your **public** internet IP. **Replace it with the
   host's LAN IP** from step 4.1 and click **update ip**.

   This is the Plex-style trick: a public DNS name that resolves to a private
   address. From outside the home it leads nowhere.
5. Verify the answer:

   ```bash
   nslookup via-home.duckdns.org 8.8.8.8
   ```

   It should print the LAN IP, for example `192.168.1.50`.

6. Fill these values into `.env`:

   ```dotenv
   DUCKDNS_DOMAIN=via-home
   VIA_HOST=via-home.duckdns.org
   DUCKDNS_TOKEN=your-duckdns-token
   ```

   `DUCKDNS_DOMAIN` is the label only, without `.duckdns.org`. `VIA_HOST` is
   the full name people open.

**If the name does not resolve**

- Some routers enable **DNS rebinding protection**, which blocks public names
  that answer with private addresses. Add `duckdns.org` to the router's
  exceptions, or use a public resolver on the device.
- Privacy DNS and VPN services (Mullvad, NextDNS, AdGuard, Pi-hole) often block
  the same answers. Allow the name, or turn the filter off on the home network.
- On the host itself, the name may not resolve because of a local DNS client.
  Test with `curl --resolve via-home.duckdns.org:443:192.168.1.50 https://via-home.duckdns.org/`
  instead.

### 4.3 Configure the root `.env`

Create it from the template:

```bash
cp .env.example .env
chmod 600 .env
```

Fill in every required value. This is the complete template:

```dotenv
# DuckDNS
DUCKDNS_DOMAIN=via-home
VIA_HOST=via-home.duckdns.org
DUCKDNS_TOKEN=your-duckdns-token

# Host LAN address. start.sh rewrites this line automatically.
LAN_IP=192.168.1.50

# Redis password. Generate with: openssl rand -hex 32
REDIS_PASSWORD=replace-with-a-long-random-value

# Shared TURN secret. Generate with: openssl rand -hex 32
TURN_SECRET=replace-with-a-different-long-random-value

# Session lifetimes, in seconds.
SESSION_TTL_SECONDS=600
REFRESH_SESSION_TTL_SECONDS=1800
SESSION_MAX_LIFETIME_SECONDS=86400
SESSION_EXPIRY_WARNING_SECONDS=30
COMPLETED_SESSION_TTL_SECONDS=30
```

Generate the two secrets separately:

```bash
openssl rand -hex 32   # REDIS_PASSWORD
openssl rand -hex 32   # TURN_SECRET
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DUCKDNS_DOMAIN` | Yes | — | The DuckDNS label only, e.g. `via-home` |
| `VIA_HOST` | Yes | — | Full public name, e.g. `via-home.duckdns.org` |
| `DUCKDNS_TOKEN` | Yes | — | DuckDNS API token; used for the DNS-01 challenge and DDNS updates |
| `LAN_IP` | Yes | — | Host's private IPv4; rewritten by `start.sh` |
| `REDIS_PASSWORD` | Yes | — | Password for the Redis container |
| `TURN_SECRET` | Yes | — | Shared secret for coturn and the API's ephemeral credentials |
| `SESSION_TTL_SECONDS` | No | `600` | Initial session lifetime |
| `REFRESH_SESSION_TTL_SECONDS` | No | `1800` | Lifetime after a peer joins or the session refreshes |
| `SESSION_MAX_LIFETIME_SECONDS` | No | `86400` | Absolute cap on session age |
| `SESSION_EXPIRY_WARNING_SECONDS` | No | `30` | How early the server warns clients; `0` disables it |
| `COMPLETED_SESSION_TTL_SECONDS` | No | `30` | Window after completion before the session closes |

`start.sh` also accepts `VIA_LAN_IP` as an environment override; it is not a
`.env` key.

> **Why two secrets?** `REDIS_PASSWORD` protects the session store.
> `TURN_SECRET` signs short-lived relay credentials and is shared by the API
> and coturn. Reusing one secret would let a leak in one area affect the other.

### 4.4 Start and verify

```bash
./scripts/start.sh
```

What the script does:

1. Refuses to run if `.env` is missing.
2. Detects the host's LAN IPv4 (or uses `VIA_LAN_IP`).
3. Rewrites only the `LAN_IP=` line in `.env`, preserving comments and secrets.
4. Runs `docker compose up -d --build`.

The first build takes a few minutes. Watch the certificate:

```bash
docker compose logs -f caddy
```

Success looks like `certificate obtained successfully`. Press Ctrl+C.

Check the services:

```bash
docker compose ps
```

Verify the app from the host:

```bash
curl -sk https://via-home.duckdns.org/api/v1/health
```

Expected: HTTP 200 and a JSON body with `"checks":{"redis":true}`. Drop `-k`
once DNS works, so curl also verifies the certificate chain.

If local DNS does not resolve the name:

```bash
curl -sk --resolve via-home.duckdns.org:443:192.168.1.50 \
  https://via-home.duckdns.org/api/v1/health
```

Then open the site on a phone or another computer on the same Wi-Fi and run a
small transfer.

The admin console is host-only:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/config   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://via-home.duckdns.org/config  # 404
```

Open `http://127.0.0.1:8081/config` on the host and sign in with
`admin` / `admin`; change the password before saving any other setting.

### 4.5 Caddy and TLS

Caddy is the only service exposed to the LAN on 80 and 443. It:

- obtains and renews a Let's Encrypt certificate;
- redirects `http://` to `https://`;
- reverse-proxies everything to `web:8080`.

**How the certificate works without an open port**

Caddy uses the **DNS-01** challenge: it writes a TXT record through the DuckDNS
API, and Let's Encrypt checks public DNS. Nothing on the router needs to be
forwarded. The custom image adds the DuckDNS plugin:

```dockerfile
FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/caddy-dns/duckdns
```

The relevant Caddyfile:

```caddyfile
{$VIA_HOST} {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
		resolvers 9.9.9.9 8.8.8.8
	}
	reverse_proxy web:8080
}

http://:80 {
	redir https://{$VIA_HOST}{uri} permanent
}
```

- The resolvers are set to Quad9 and Google because `1.1.1.1` is blocked on
  some networks. Changing them can break renewal on those networks.
- The certificate is stored in the `caddy_data` and `caddy_config` volumes.
  Rebuilding does **not** request a new certificate.
- Do not delete those volumes casually: Let's Encrypt rate-limits repeated
  issuance.

**Certificate troubleshooting**

```bash
docker compose logs caddy
docker compose restart caddy
```

Check:

- `DUCKDNS_TOKEN` belongs to the account that owns `DUCKDNS_DOMAIN`.
- `VIA_HOST` exactly matches the DuckDNS name.
- The host can reach DuckDNS and the ACME directory over HTTPS.
- The certificate volumes still exist.

### 4.6 The Compose stack

`docker-compose.yml` defines six services. Each one is read-only, drops every
Linux capability except where noted, disallows privilege escalation, and has
memory and process limits.

| Service | Image | Runs as | Networks | Ports | Purpose |
|---|---|---|---|---|---|
| `caddy` | Caddy 2.10 + DuckDNS plugin | root, `NET_BIND_SERVICE` only | `edge` | 80, 443 | TLS, redirect, reverse proxy |
| `web` | nginx-unprivileged 1.29 + frontend build | uid 101 | `edge`, `app` | internal 8080; host loopback 8081 | Serves the SPA, proxies `/api` and `/socket.io`; admin console on loopback |
| `api` | Node 24, production dependencies | uid 1000 | `app`, `data` | internal 3000 | Express + Socket.IO signaling and admin API |
| `redis` | Redis 7.4 | uid 999 | `data` | internal 6379 | Session store, password required, no persistence |
| `coturn` | coturn 4.6 | uid 65534, `NET_BIND_SERVICE` only | `edge` | 3478, 49300–49340 | Fallback relay |
| `ddns` | Alpine 3.20 | uid 65534 | `default` | — | Needs outbound internet to update DuckDNS hourly |

**Networks**

| Network | Subnet | Members | Notes |
|---|---|---|---|
| `edge` | `172.30.0.0/24` | caddy, web, coturn | Caddy needs internet access for certificates |
| `app` | `172.30.1.0/24` | web, api | `internal: true`; referenced by `TRUSTED_PROXIES` |
| `data` | `172.30.2.0/24` | api, redis | `internal: true`; no route out |

The pinned subnets matter: `docker/web.nginx.conf` trusts `172.30.0.0/24` for
client IPs, and the API trusts `172.30.1.0/24`. Change them together or the
per-IP limits will either trust spoofed headers or treat the whole household as
one client.

**Volumes**

| Volume | Purpose |
|---|---|
| `caddy_data` | Certificate and ACME account |
| `caddy_config` | Caddy's runtime configuration |
| `settings` | Admin settings and password hash for the host-only config page |

Sessions are short-lived and Redis does not write to disk. Back up `settings`
if you want to keep the admin credentials and runtime overrides.

**Frontend proxy**

`docker/web.nginx.conf` serves the built SPA and proxies:

- `/api/` → `http://api:3000`
- `/socket.io/` → `http://api:3000` with WebSocket upgrade
- `/healthz` → local `200 ok`
- `/config` and `/api/v1/admin/*` → served only on the loopback listener
  `127.0.0.1:8081`; the public site returns 404 for both

It also sets the security headers, including the Content-Security-Policy. The
CSP allows connections only to the page's own origin (`connect-src 'self'
wss://$host`). If you point `VITE_ERROR_REPORTING_URL` at another host, add
that host to the CSP or the browser will block the reports.

### 4.7 Backend runtime configuration

The backend validates only one variable as required: `REDIS_URL`. Everything
else has a safe default. Docker Compose supplies the deployment-specific
values.

**Set by `docker-compose.yml`**

| Variable | Value in Compose | Why |
|---|---|---|
| `REDIS_URL` | `redis://:<password>@redis:6379` | Connects to the Redis service |
| `CLIENT_ORIGIN` | `https://${VIA_HOST}` | Only the site's own origin may connect |
| `TRUSTED_PROXIES` | `172.30.1.0/24` | Only nginx may report the client IP |
| `SESSION_TTL_SECONDS` | `${SESSION_TTL_SECONDS:-600}` | From root `.env` |
| `REFRESH_SESSION_TTL_SECONDS` | `${REFRESH_SESSION_TTL_SECONDS:-1800}` | From root `.env` |
| `SESSION_MAX_LIFETIME_SECONDS` | `${SESSION_MAX_LIFETIME_SECONDS:-86400}` | From root `.env` |
| `SESSION_EXPIRY_WARNING_SECONDS` | `${SESSION_EXPIRY_WARNING_SECONDS:-30}` | From root `.env` |
| `COMPLETED_SESSION_TTL_SECONDS` | `${COMPLETED_SESSION_TTL_SECONDS:-30}` | From root `.env` |
| `STUN_URLS` | `stun:${VIA_HOST}:3478` | Keeps STUN discovery local |
| `TURN_URLS` | `turn:${VIA_HOST}:3478?transport=udp,turn:${VIA_HOST}:3478?transport=tcp` | Points at coturn |
| `TURN_SECRET` | `${TURN_SECRET}` | Matches coturn's shared secret |
| `SETTINGS_PATH` | `/config/settings.json` | Persisted admin settings, mounted on the `settings` volume |

The session lifetimes, limits and STUN/TURN URL values above are starting
defaults. The host-only admin page at `http://127.0.0.1:8081/config` overrides
them in `/config/settings.json`; changes apply to new sessions and sockets.
Only the host can reach that port, and the public site returns 404 for
`/config`. The default admin account is `admin` / `admin`; change it on first
sign-in. Secrets such as `TURN_SECRET`, the Redis password and the DuckDNS
token remain in `.env` and are never returned to the browser.

**Optional backend variables**

These can be added to the `api` service's `environment:` block in
`docker-compose.yml` (or set in `backend/.env` for local development).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `NODE_ENV` | `production` in the image | `production` enforces same-origin when `CLIENT_ORIGIN` is empty; development allows any origin |
| `LOG_LEVEL` | `info` | `debug` adds per-message signaling logs |
| `MAX_ACTIVE_SESSIONS_PER_PEER` | `1` | Sessions one connection may own |
| `MAX_SOCKETS_PER_IP` | `20` | Concurrent sockets from one client address |
| `RECOVERY_WINDOW_SECONDS` | `120` | How long a dropped socket may recover before cleanup |
| `MAX_FILE_SIZE_BYTES` | `0` | Largest announced file size; `0` means no server-side cap |
| `TURN_TTL_SECONDS` | `86400` | Lifetime of a minted TURN credential |
| `TURN_CREDENTIAL_ALGORITHM` | `sha1` | `sha1` for coturn's `--use-auth-secret`; `sha256` for relays that expect it |

**Session behavior**

- `create-session` grants `SESSION_TTL_SECONDS`.
- Joining or refreshing grants `REFRESH_SESSION_TTL_SECONDS`, capped by
  `SESSION_MAX_LIFETIME_SECONDS`.
- `SESSION_EXPIRY_WARNING_SECONDS` controls the `session:expiring` push
  before expiry; `0` disables it.
- `COMPLETED_SESSION_TTL_SECONDS` shortens the session after the receiver
  confirms the transfer, so both peers can see the result before it closes.
- `RECOVERY_WINDOW_SECONDS` defers cleanup after a recoverable Socket.IO drop.

**TURN credentials**

`GET /api/v1/ice-servers?sessionId=<id>` returns STUN and TURN settings for a
live session. It refuses invalid or expired sessions (`400`/`404`) and answers
`503` when no relay is configured. Credentials are minted per request with a
`Cache-Control: private, no-store` header.

### 4.8 Frontend build configuration

Vite embeds `VITE_*` values at **build time**. Changing them requires a rebuild,
not just a restart.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SOCKET_SERVER_URL` | empty → page's own origin | Socket.IO signaling URL |
| `VITE_API_BASE_URL` | `<socket origin>/api/v1` | REST base for health and ICE credentials |
| `VITE_ERROR_REPORTING_URL` | unset → disabled | Optional endpoint for privacy-preserving error and Web Vitals reports |
| `VITE_MAX_RECOVERY_ATTEMPTS` | `2` | Retries before a broken transfer gives up |

The Compose build passes empty socket and API URLs, which means same-origin:
the page talks to `/api` and `/socket.io` on whatever host served it. This is
the recommended production setup and requires no CORS configuration.

If you change `VITE_ERROR_REPORTING_URL` to another host, also add that host to
the CSP in `docker/web.nginx.conf`.

Rebuild after changing build args:

```bash
docker compose build web
docker compose up -d web
```

### 4.9 Local development

The apps use their own `.env` files. They are not used by Docker Compose.

**Backend**

```bash
cd backend
npm ci
cp .env.example .env
npm run db:up        # test Redis :6379 and coturn :3478
npm run dev          # http://localhost:3000
```

`backend/.env` keys:

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | required | Session store, e.g. `redis://127.0.0.1:6379` |
| `CLIENT_ORIGIN` | empty | Allowed origins; empty allows any origin in development |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `SESSION_*` | see above | Session lifetimes |
| `RECOVERY_WINDOW_SECONDS` | `120` | Socket recovery window |
| `MAX_ACTIVE_SESSIONS_PER_PEER` | `1` | Sessions per peer |
| `MAX_SOCKETS_PER_IP` | `20` | Sockets per IP |
| `MAX_FILE_SIZE_BYTES` | `0` | Optional size cap |
| `TRUSTED_PROXIES` | `127.0.0.1/32,::1` | Proxies allowed to report client IPs |
| `STUN_URLS` | public Google STUN | STUN override |
| `TURN_URLS`, `TURN_SECRET` | unset | Optional relay |
| `TURN_TTL_SECONDS` | `86400` | Credential lifetime |
| `TURN_CREDENTIAL_ALGORITHM` | `sha1` | Credential signing algorithm |

> The development Compose file publishes Redis and coturn on the host. If the
> production stack is running, stop it first (`docker compose down` from the
> root) or the ports will conflict.

**Frontend**

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev          # Vite on http://localhost:5173
```

`frontend/.env` keys:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SOCKET_SERVER_URL` | required in development | Backend URL, e.g. `http://localhost:3000` |
| `VITE_API_BASE_URL` | derived | REST base |
| `VITE_ERROR_REPORTING_URL` | unset | Optional error reporting |
| `VITE_MAX_RECOVERY_ATTEMPTS` | `2` | Transfer retries |

Web Crypto and the File System Access API require a **secure context**.
`http://localhost` and `http://127.0.0.1` count; a plain HTTP LAN address does
not.

**Useful commands**

| Command | What it does |
|---|---|
| `cd backend && npm test` | Build and run smoke checks (no services needed) |
| `cd backend && npm run test:integration` | Integration tests against Redis and coturn (`db:up` first) |
| `cd frontend && npm test` | Vitest unit tests |
| `cd frontend && npm run test:e2e` | Playwright tests against the mock signaling server |
| `cd frontend && npm run test:e2e:backend` | End-to-end test against a real backend on `127.0.0.1:3000` |
| `docker compose config --quiet` | Validate the root Compose file and `.env` |

### 4.10 Single-container variant

The root `Dockerfile`, `docker/entrypoint.sh` and `docker/nginx.conf` build a
legacy all-in-one image containing nginx, Redis, the API and optionally coturn.
**It is not used by `docker-compose.yml` and is not the supported deployment.**
It does not include Caddy, so TLS must be terminated by something in front of
it.

Build:

```bash
docker build -t via:single .
```

Run (HTTP on port 80; only enable TURN if you publish its ports):

```bash
docker run -d --name via \
  -p 80:80 \
  -p 3478:3478 -p 3478:3478/udp \
  -p 49160-49200:49160-49200/udp \
  -e TURN_ENABLED=true \
  -e TURN_HOST=192.168.1.50 \
  -e EXTERNAL_IP=192.168.1.50 \
  -e TURN_SECRET=replace-with-a-long-random-value \
  via:single
```

Entrypoint variables:

| Variable | Default | Purpose |
|---|---|---|
| `TURN_ENABLED` | `true` | Set `false` to skip coturn entirely |
| `TURN_HOST` | `127.0.0.1` | Host used in the TURN URLs |
| `TURN_URLS` | derived from `TURN_HOST` | Explicit relay URLs |
| `EXTERNAL_IP` | `TURN_HOST` | Address advertised to clients |
| `TURN_REALM` | `via` | TURN realm |
| `TURN_MIN_PORT` / `TURN_MAX_PORT` | `49160` / `49200` | Relay port range |
| `TURN_SECRET` | generated if unset | Shared secret |

The image accepts `VITE_SOCKET_SERVER_URL`, `VITE_API_BASE_URL` and
`VITE_ERROR_REPORTING_URL` as **build arguments**. If a TLS reverse proxy fronts
the container, build with the `https://` URLs and keep port 80 on the private
network:

```bash
docker build \
  --build-arg VITE_SOCKET_SERVER_URL=https://via-home.duckdns.org \
  --build-arg VITE_API_BASE_URL=https://via-home.duckdns.org/api/v1 \
  -t via:single .
```

Prefer the split Compose stack for anything long-lived: it has Caddy, the
hardened containers, internal networks and the supported update path.

---

## Operations

### Everyday commands

```bash
./scripts/start.sh                 # detect LAN IP, rebuild if needed, start
docker compose ps                  # health and status
docker compose logs -f api         # or caddy, web, redis, coturn, ddns
docker compose down                # stop; keeps the certificate volumes
docker compose down -v             # stop AND delete caddy_data/caddy_config
```

Avoid `down -v` unless you intend to discard the certificate. Re-issuing it
repeatedly can hit Let's Encrypt rate limits.

### Update to a new version

```bash
git pull
./scripts/start.sh
```

The script rebuilds changed images and restarts the stack. Caddy keeps its
certificate.

### Change networks or the host IP

```bash
./scripts/start.sh
```

It detects the new LAN address, rewrites `LAN_IP`, and recreates the affected
containers. The `ddns` container re-asserts the record hourly, but only for the
address it started with, so run the script (or `docker compose up -d`) after a
change.

### Change the DuckDNS name

1. Update `DUCKDNS_DOMAIN` and `VIA_HOST` in `.env`.
2. Ensure the new name exists in DuckDNS and points at the LAN IP.
3. Run:

   ```bash
   docker compose up -d caddy ddns api
   ```

Caddy requests a certificate for the new name, and the API's `CLIENT_ORIGIN`,
STUN and TURN URLs are recreated from the new `VIA_HOST`. The old record can be
removed from DuckDNS once you no longer need it.

### Rotate secrets

**Redis password**

```bash
# edit REDIS_PASSWORD in .env
docker compose up -d redis api
```

Redis runs without persistence, so recreating it discards active sessions. That
is expected; start a new transfer afterwards.

**TURN secret**

```bash
# edit TURN_SECRET in .env
docker compose up -d coturn api
```

Both services must receive the same new value. Existing relay allocations end
when coturn restarts.

### Tune session lifetimes

Edit the `SESSION_*` values in `.env`, then recreate the API:

```bash
docker compose up -d api
```

### Backups

There is no application data to back up. The only persistent state is the
Caddy certificate:

- `caddy_data`
- `caddy_config`

`docker compose down` keeps them; `docker compose down -v` deletes them.

### Health checks

```bash
curl -sk https://your-name.duckdns.org/api/v1/health
curl -sk https://your-name.duckdns.org/healthz
docker compose ps
```

`/api/v1/health` returns `200` only when Redis answers. A `503` means the API is
up but degraded.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The name resolves on mobile data but not on Wi-Fi | Router DNS rebinding protection | Add `duckdns.org` to the router's exceptions, or use a public resolver on the device |
| The name does not resolve with a privacy DNS or VPN | Mullvad, NextDNS, AdGuard, Pi-hole block private-IP answers | Allow the name in that service, or disable the filter on the home network |
| Caddy logs show DNS or ACME errors | Wrong token/domain, or DuckDNS unreachable | Check `DUCKDNS_TOKEN` and `DUCKDNS_DOMAIN`, then `docker compose restart caddy` |
| Caddy keeps requesting certificates | `caddy_data`/`caddy_config` were deleted | Restore the volumes or accept one new issuance; avoid repeated deletions |
| Site stopped after a router reboot | The host got a new IP | Run `./scripts/start.sh`; add a DHCP reservation |
| Devices can't reach each other | AP/client isolation on the Wi-Fi | Turn it off, especially on guest networks |
| Metadata arrives but the file never starts | The direct path failed and TURN is unreachable | Check `docker compose ps coturn` is healthy and ports 3478 + UDP 49300–49340 reach the host |
| TURN authentication errors | `TURN_SECRET` mismatch | Set the same value for `api` and `coturn`, then recreate both |
| `503 relay is not configured` | `TURN_URLS`/`TURN_SECRET` empty | Set them in `.env` (Compose does this for the split stack) |
| "This link is missing its security key" | The link was shortened | Share the whole link, including `#k=...` |
| "Security check failed" | Wrong/edited link, or a man in the middle | Start a new transfer with a fresh link |
| `429 too many requests` | Per-IP rate limit | Wait and retry. On Docker Desktop, every device may look like one address, so limits are per household |
| Receiving fails in Firefox/Safari for a large file | Temporary storage is capped at 512 MB when OPFS is unavailable | Use Chrome or Edge, or send a smaller file |
| A cancelled direct save leaves a partial file | The browser wrote directly to the chosen path | Delete the partial file and retry |
| Error reports blocked by the browser | CSP does not allow the reporting host | Add the host to `connect-src` in `docker/web.nginx.conf` |
| Port already in use during local tests | Production stack is running | `docker compose down` at the root, then `npm run db:up` in `backend/` |

---

## Security checklist

- [ ] `.env` is present, has mode `600`, and is **never** committed, printed or
      uploaded.
- [ ] No router ports are forwarded to the host.
- [ ] `REDIS_PASSWORD` and `TURN_SECRET` are long, random and different.
- [ ] `CLIENT_ORIGIN` is `https://$VIA_HOST`, not `*`.
- [ ] `docker compose ps` shows healthy services.
- [ ] The certificate is stored in the Caddy volumes and not deleted casually.
- [ ] New error-reporting hosts are added to the CSP.
- [ ] Containers keep their read-only filesystems, dropped capabilities and
      internal networks.
- [ ] The link key stays in the URL fragment and is never pasted into logs or
      tickets.

---

## Reference

### Config file map

| File | Scope | Tracked | Notes |
|---|---|---|---|
| `.env.example` | Root deployment template | Yes | Copy to `.env`; never commit `.env` |
| `.env` | Root deployment secrets | No | Gitignored |
| `docker-compose.yml` | Production stack | Yes | Services, networks, volumes, hardening |
| `docker/Caddyfile` | TLS and reverse proxy | Yes | DuckDNS DNS-01, HTTP redirect |
| `docker/caddy/Dockerfile` | Caddy + DuckDNS plugin | Yes | Custom image |
| `docker/web.nginx.conf` | Frontend + proxy | Yes | CSP, HSTS, rate limits, real IP |
| `scripts/start.sh` | Start helper | Yes | Detects LAN IP, rewrites `.env`, runs Compose |
| `scripts/detect-lan-ip.sh` | LAN detection | Yes | Physical interfaces and private ranges only |
| `backend/.env.example` | Backend local dev template | Yes | Copy to `backend/.env` |
| `backend/.env` | Backend local dev values | No | Gitignored |
| `backend/docker-compose.yml` | Dev Redis + coturn | Yes | Used by `npm run db:up` |
| `backend/src/config/env.ts` | Backend defaults/validation | Yes | Source of truth for defaults |
| `frontend/.env.example` | Frontend local dev template | Yes | Copy to `frontend/.env` |
| `frontend/.env` | Frontend local dev values | No | Gitignored |
| `frontend/src/lib/env.ts` | Frontend URL resolution | Yes | Same-origin fallback |
| `frontend/src/lib/constants.ts` | Frontend limits | Yes | Recovery attempts, chunk size |
| `frontend/Dockerfile` | Frontend build | Yes | `VITE_*` build args |
| `Dockerfile` | Legacy single-container build | Yes | Not used by Compose |
| `docker/entrypoint.sh` | Legacy runtime | Yes | `TURN_*` variables |
| `docker/nginx.conf` | Legacy nginx config | Yes | Port 80, same security headers |

### Master environment reference

| Variable | Scope | Required | Default | Set by |
|---|---|---|---|---|
| `DUCKDNS_DOMAIN` | Root `.env` | Yes | — | You |
| `VIA_HOST` | Root `.env` | Yes | — | You |
| `DUCKDNS_TOKEN` | Root `.env` | Yes | — | You |
| `LAN_IP` | Root `.env` | Yes | — | `start.sh` |
| `REDIS_PASSWORD` | Root `.env` | Yes | — | You |
| `TURN_SECRET` | Root `.env` | Yes | — | You |
| `SESSION_TTL_SECONDS` | Root `.env` → API | No | `600` | You / Compose |
| `REFRESH_SESSION_TTL_SECONDS` | Root `.env` → API | No | `1800` | You / Compose |
| `SESSION_MAX_LIFETIME_SECONDS` | Root `.env` → API | No | `86400` | You / Compose |
| `SESSION_EXPIRY_WARNING_SECONDS` | Root `.env` → API | No | `30` | You / Compose |
| `COMPLETED_SESSION_TTL_SECONDS` | Root `.env` → API | No | `30` | You / Compose |
| `REDIS_URL` | API | Yes | — | Compose / dev `.env` |
| `CLIENT_ORIGIN` | API | No | same host in production | Compose |
| `TRUSTED_PROXIES` | API | No | `127.0.0.1/32,::1` | Compose |
| `PORT` | API | No | `3000` | Compose / dev `.env` |
| `NODE_ENV` | API | No | `production` in the image | `Dockerfile` |
| `LOG_LEVEL` | API | No | `info` | Optional |
| `MAX_ACTIVE_SESSIONS_PER_PEER` | API | No | `1` | Optional |
| `MAX_SOCKETS_PER_IP` | API | No | `20` | Optional |
| `RECOVERY_WINDOW_SECONDS` | API | No | `120` | Optional |
| `MAX_FILE_SIZE_BYTES` | API | No | `0` | Optional |
| `STUN_URLS` | API | No | public Google STUN | Compose |
| `TURN_URLS` | API | No | unset | Compose |
| `TURN_SECRET` | API + coturn | No | unset | Compose |
| `TURN_TTL_SECONDS` | API | No | `86400` | Optional |
| `TURN_CREDENTIAL_ALGORITHM` | API | No | `sha1` | Optional |
| `VITE_SOCKET_SERVER_URL` | Frontend build | No | same origin | Build arg / dev `.env` |
| `VITE_API_BASE_URL` | Frontend build | No | derived | Build arg / dev `.env` |
| `VITE_ERROR_REPORTING_URL` | Frontend build | No | unset | Build arg / dev `.env` |
| `VITE_MAX_RECOVERY_ATTEMPTS` | Frontend build | No | `2` | Build arg / dev `.env` |
| `TURN_ENABLED` | Legacy container | No | `true` | `docker run -e` |
| `TURN_HOST` | Legacy container | No | `127.0.0.1` | `docker run -e` |
| `EXTERNAL_IP` | Legacy container | No | `TURN_HOST` | `docker run -e` |
| `TURN_REALM` | Legacy container | No | `via` | `docker run -e` |
| `TURN_MIN_PORT` / `TURN_MAX_PORT` | Legacy container | No | `49160` / `49200` | `docker run -e` |

### Command cheatsheet

```bash
# First run
cp .env.example .env && chmod 600 .env
./scripts/start.sh

# Status and logs
docker compose ps
docker compose logs -f caddy
docker compose logs -f api

# Rebuild one service
docker compose build web && docker compose up -d web

# Stop (keep certificates) / stop and delete certificates
docker compose down
docker compose down -v

# Validate configuration
docker compose config --quiet

# Local development
cd backend && npm ci && cp .env.example .env && npm run db:up && npm run dev
cd frontend && npm ci && cp .env.example .env && npm run dev
```

### Glossary

| Term | Meaning |
|---|---|
| **ACME** | The protocol Let's Encrypt uses to issue certificates |
| **DNS-01** | An ACME challenge that proves control by publishing a DNS TXT record; needs no open port |
| **STUN** | Lets a browser discover its public address so peers can try a direct connection |
| **TURN** | A relay used when a direct connection is impossible; Via relays only encrypted packets |
| **ICE** | The process that gathers candidates and picks a working path |
| **DTLS** | The encryption layer under WebRTC data channels |
| **OPFS** | Origin Private File System, browser storage used for temporary downloads |
| **CSP** | Content-Security-Policy, the browser rule set limiting where the page may connect |
