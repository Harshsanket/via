# CLAUDE.md: agent handoff for Via

This is for any coding agent, or new maintainer, picking up Via. Read it before changing anything. It covers the layout, how to run and test, the invariants that quietly break things if you touch them, and how to security-test. The user-facing guide is [README.md](README.md).

---

## 1. What Via is, in one paragraph

A self-hosted, browser-to-browser file sharing app for one home network. The **frontend** (React + Vite) does the actual transfer over a direct WebRTC data channel. The **backend** (Express + Socket.IO + Redis) only pairs browsers (signaling) and holds short-lived sessions. The deployment runs in Docker Compose behind **Caddy**, which gets a real Let's Encrypt certificate for a public DuckDNS name that resolves to the host's **LAN IP**, so every device gets trusted HTTPS with nothing to install. Security model: **the frontend and backend don't trust each other**. Each validates the other, and the two browsers verify each other end to end with a key the server never sees.

---

## 2. Layout and ownership

```
via/                      ← project root: NOT a git repository
├── README.md, CLAUDE.md, LICENSE (GPL-3.0-only; same text in backend/ and frontend/)
├── docker-compose.yml    ← the supported deployment (split, hardened stack)
├── .env / .env.example   ← secrets live in .env (never commit, never print)
├── Dockerfile            ← legacy single-container image (unused by compose)
├── docker/
│   ├── Caddyfile, caddy/Dockerfile   ← TLS edge + DuckDNS DNS-01 plugin
│   ├── web.nginx.conf                ← nginx for the `web` service (USED)
│   ├── nginx.conf, entrypoint.sh     ← single-container variant only
├── backend/              ← its own git repo
├── frontend/             ← its own git repo
└── docs-internal/        ← LOCAL-ONLY agent records; never commit, publish or upload
```

- **Three separate places to commit:** `backend/` and `frontend/` are independent git repos, and the root is not under git at all. Changes to `docker/`, `docker-compose.yml`, `README.md` and `CLAUDE.md` aren't version-controlled unless the owner sets up a repo there.
- **`docs-internal/` has its own rules** in `docs-internal/AGENTS.md` and `docs-internal/docs-internal/AGENT.md`. Follow them when you work there. Records of past work live in `docs-internal/docs-internal/docs/`:
  - `progress.md`: append-only work log;
  - `decisions.md`: ADR-0001 (DuckDNS + Caddy hosting), ADR-0002 (link-key verification);
  - `findings.md`, `security-hardening-plan.md`, `lan-hosting.md`.

  Read these for history and *why*. Append to `progress.md` and `decisions.md` in their format; never rewrite earlier entries.
- **The frontend repo may contain the owner's own uncommitted work** (UI and theme changes). **Never `git add -A` in `frontend/`.** Stage only your own hunks, as the previous handoff did with `git apply --cached`, and leave the rest as it is.
- **Commit and push only when asked.** Both repos have a `security-hardening` branch with earlier work; don't commit straight to `main`. The backend's `git config user.email` is a placeholder (`your-email@example.com`); ask the owner before committing under it.

### Key files

| Concern | Backend (`backend/src/…`) | Frontend (`frontend/src/…`) |
|---|---|---|
| Socket events and handlers | `config/socket/session.ts`, `config/webrtc/index.ts` | `socket/*.ts` (wrapped by `socket/guard.ts`) |
| Payload validation | `config/socket/utils.ts` (parsers and size caps) | `lib/server-events.ts` (server→client), `lib/transfer-protocol.ts` (peer frames) |
| Sessions, atomically | `config/redis/scripts.ts` (Lua), `config/redis/service.ts` | — |
| Rate limits and per-IP cap | `config/socket/rate-limit.ts` | — |
| Origin / CORS | `config/env.ts` (`isAllowedOrigin`), `server.ts` (`allowRequest`), `middleware/cors-middleware.ts` | — |
| End-to-end verification and encryption | — | `lib/peer-auth.ts`; used in `pages/send/useSendSession.ts` and `pages/receive/useReceiveSession.ts` |
| File writing | — | `lib/file-sink.ts` (OPFS, picker, memory; stale `.part` sweep) |

---

## 3. Setup

### Run the whole stack (what the owner uses)

```bash
cp .env.example .env        # fill DUCKDNS_*, VIA_HOST, LAN_IP, REDIS_PASSWORD
```
```bash
docker compose up -d --build
```
```bash
docker compose ps           # all healthy; caddy/ddns show "Up"
```

The live instance is `https://hs-via.duckdns.org` → `192.168.0.240`. From the host, `curl --resolve hs-via.duckdns.org:443:192.168.0.240 …` bypasses local DNS. The owner's Mac uses Mullvad DNS, which doesn't resolve the name.

### Backend development

```bash
cd backend
```
```bash
npm ci
```
```bash
npm run db:up              # test Redis :6379 + coturn :3478 (backend/docker-compose.yml)
```
```bash
REDIS_URL=redis://127.0.0.1:6379 npm run dev
```

`NODE_ENV` isn't production in dev, so any origin is allowed when `CLIENT_ORIGIN` is empty.

### Frontend development

```bash
cd frontend
```
```bash
npm ci
```
```bash
VITE_SOCKET_SERVER_URL=http://127.0.0.1:3000 npm run dev
```

Web Crypto (used for verification) needs a secure context. `localhost` and `127.0.0.1` count; a LAN IP over plain HTTP doesn't.

---

## 4. How to work here

1. **Read before you edit.** Match the surrounding style: comments explain *why*, Prettier in the backend, ESLint in the frontend, no semicolons in the frontend.
2. **Write the failing test first** for any bug or security fix, watch it fail for the right reason, then fix. Every security property below has a test; keep it that way.
3. **Change contracts on both sides at once.** A change to a socket event, a payload field or a size cap needs the backend parser, the frontend parser, `frontend/e2e/mock-signaling-server.mjs`, and tests on both sides.
4. **Verify before you claim** (see section 7). Report failures honestly, with output.
5. **Log your work** in `docs-internal/docs-internal/docs/progress.md`, and record consequential decisions as an ADR.

---

## 5. Invariants: don't break these

### End-to-end security (frontend)

- **The link key lives only in the URL fragment** (`/receive/<id>#k=<22 chars>`). Never put it in a query string, a header, a socket payload, logs, analytics (`lib/observability.ts`) or the server. `buildReceiveUrl(id, key)` and `extractReceiveLink` are the only ways in and out.
- **Nothing on the data channel is acted on before peer verification.**
  - Both hooks gate on `peerVerifiedRef`, queue up to 32 early frames, and replay them after verification.
  - New control frames must be added to `parseControlFrame` and handled *after* the gate.
  - `handleSendFile` and `handleStartDownload` must also check verification.
- **Every channel open re-runs the handshake** (`startPeerAuth`), resumes included. Fingerprints come from `pc.localDescription` and `pc.remoteDescription`; don't cache them across peer connections.
- **Metadata to the server is ciphertext:** `enc.v1.<base64url>`, with MIME `application/octet-stream`. The receiver decrypts, then compares the result with the data-channel metadata frame. If you change how the sender sanitizes names, keep `sanitizeFileName` idempotent, or that comparison fails.
- **Every server event goes through a parser** (`listen()`, `guardAck()` in `socket/guard.ts`). Don't add a raw `socket.on` for an event that carries a payload.
- **`sanitizeMimeType` must keep downgrading active types** (HTML, SVG, XML, JS). A received blob runs in the app's origin.

### Backend rules

- **Session IDs are server-issued UUIDs** (`isSessionId`). Test fixtures must use UUID-shaped IDs; the smoke script uses `SAMPLE_SESSION_ID`.
- **Roles:**
  - only the creator may `store-file-metadata`, once;
  - only the receiver may send `transfer-complete`, and the server relays the **stored** name;
  - a peer can't join its own session or a second session.

  All of these are enforced inside Lua scripts.
- **Never write a session hash with a plain `HSET` after a separate existence check.** It can recreate the hash with no TTL. Use the `EXISTS`-guarded scripts in `scripts.ts`.
- **Connection recovery:** Socket.IO fires `disconnect` even for recoverable drops.
  - Cleanup is deferred by `RECOVERY_WINDOW_MS` for `transport close`, `transport error` and `ping timeout`, and cancelled when `socket.recovered` is set.
  - `registerPeer` uses `SET … NX`.
  - Recovery only works after the client has received at least one event.
- **Size caps:**

  | Field | Limit |
  |---|---|
  | File name | 255 characters, or 2048 for `enc.v1.` base64url |
  | MIME type | 127 characters (otherwise stored as octet-stream) |
  | SDP | 64 KiB |
  | Candidate | 1 KiB |
  | Error message | 300 characters |

  Keep the frontend parsers in step.
- **Origins:**
  - `allowRequest` refuses foreign origins on every transport, WebSocket included;
  - with no `CLIENT_ORIGIN`, production allows the same host only;
  - **no CORS credentials anywhere**, server or client.
- **Rate limits are per socket and per event,** with a disconnect after 200 refusals. If a legitimate flow starts sending more (say ICE candidates), raise its bucket in `rate-limit.ts` rather than removing it.

### Deployment (easy to break, hard to notice)

- **Pinned subnets are referenced elsewhere.** Change them together:

  | Network | Subnet | Referenced by |
  |---|---|---|
  | `edge` | `172.30.0.0/24` | `set_real_ip_from` in `docker/web.nginx.conf` |
  | `app` | `172.30.1.0/24` | `TRUSTED_PROXIES` for `api` |

  Get these wrong and the per-IP limits either trust spoofed headers or lump every client together.
- **`caddy` needs `cap_add: [NET_BIND_SERVICE]`.** Its binary carries that file capability, and with `cap_drop: ALL` alone it won't start.
- **Caddy's DNS-01 resolvers are `9.9.9.9 8.8.8.8`.** `1.1.1.1` is refused on the owner's network, and switching back breaks certificate renewal there.
- **`redis` runs as `user: "999:1000"`** with a read-only root and a tmpfs `/data`. Its health check authenticates through `REDISCLI_AUTH`. The `api`'s `REDIS_URL` embeds `REDIS_PASSWORD`.
- **`app` and `data` are `internal: true`.** The API has no internet access. If you add a feature that needs it (external STUN, error reporting), that's a design decision; don't just make the network external.
- **CSP `connect-src 'self' wss://$host`.** Any new external endpoint needs a CSP change in `docker/web.nginx.conf`.
- **TURN stays off** for the LAN deployment. If anyone re-enables it (single-container image only), keep the `denied-peer-ip` rules in `entrypoint.sh`. Without them the relay can reach the Docker networks and the host.
- **Docker Desktop on macOS shows clients as `192.168.65.1`,** so the per-IP limits effectively apply per household. Size them for that.
- **Never forward router ports, and never print, commit or upload `.env`.** It holds the DuckDNS token and the Redis password.
- **The Caddy volumes `caddy_data` and `caddy_config` hold the certificate.** Don't delete them casually: Let's Encrypt rate-limits repeated issuance.

---

## 6. Security testing

### Automated (run all of these before saying "done")

```bash
cd backend && npm audit --omit=dev --audit-level=high
```
```bash
cd backend && npm test
```
```bash
cd backend && npm run db:up && npm run test:integration && npm run db:down
```
```bash
cd frontend && npm audit --audit-level=high && npm run lint && npx tsc -b && npm test
```
```bash
cd frontend && npx playwright test e2e/transfer.spec.ts e2e/smoke.spec.ts
```

For the real-backend end-to-end test, start the backend on :3000 with Redis, then:

```bash
cd frontend && E2E_SOCKET_URL=http://127.0.0.1:3000 npx playwright test e2e/real-backend.spec.ts
```

What these cover:

| Area | Where |
|---|---|
| Origin refusal (including WebSocket) | `backend/test/origin.integration.test.mjs` |
| Session integrity: roles, cross-session joins, recovery, no TTL-less writes | `backend/test/session-integrity.integration.test.mjs` |
| Payload caps and UUID IDs | `backend/test/payload-limits.integration.test.mjs` |
| Rate limits and per-IP cap | `backend/test/rate-limits.integration.test.mjs` |
| TURN credential minting and relay acceptance | `backend/test/ice*.mjs`, `backend/test/turn-*.mjs` |
| Fingerprint-swap (MITM), forged and replayed tags, metadata encryption | `frontend/src/lib/peer-auth.test.ts` |
| Malformed server events | `frontend/src/lib/server-events.test.ts` |
| Impostor with the session ID but the wrong key gets nothing | the "never gets the file" test in `frontend/e2e/transfer.spec.ts` |

### Manual checks against the live stack (from the host)

Set these first, then run the checks:

```bash
R=(--resolve hs-via.duckdns.org:443:192.168.0.240); U=https://hs-via.duckdns.org
```

| Check | Command | Expected result |
|---|---|---|
| Foreign origin refused | `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' "${R[@]}" "$U/socket.io/?EIO=4&transport=polling"` | `403` |
| Same origin allowed | the same request with `-H "Origin: $U"` | `200` |
| CSP sent | `curl -sI "${R[@]}" "$U/" \| grep -i content-security` | `connect-src 'self' wss://…` |
| No credentials header | `curl -sD - -o /dev/null -H "Origin: $U" "${R[@]}" "$U/api/v1/health" \| grep -i allow-credentials` | prints nothing |
| Rate limit | `for i in $(seq 80); do curl -s -o /dev/null -w '%{http_code} ' "${R[@]}" "$U/api/v1/health" & done; wait` | some `429` |
| Spoofed IP ignored | `curl -s -o /dev/null -H 'X-Forwarded-For: 6.6.6.6' "${R[@]}" "$U/api/v1/health"`, then `docker compose logs web` | no `6.6.6.6` in the log |

Container isolation, expected to fail or be refused in each case:

```bash
docker compose exec web sh -c 'nc -z -w2 redis 6379'
```
```bash
docker compose exec caddy sh -c 'nc -z -w2 api 3000'
```
```bash
docker compose exec api sh -c 'wget -q -T3 -O- https://example.com'
```
```bash
docker compose exec redis redis-cli -a wrong --no-auth-warning ping
```
```bash
docker compose exec api touch /app/x
```

The last one should fail with a read-only filesystem error.

### Threat model: questions to keep asking

- **Can the server (or anyone holding only a session ID) learn a file's name or contents, or receive it?** It must not.
- **Can either peer act outside its role** (overwrite metadata, confirm on the other's behalf, resurrect a session)?
- **Can one client exhaust Redis, sockets or logs?** Check event budgets, caps and log levels.
- **Does any new code path reach a WebRTC peer or a file sink before `peerVerifiedRef` is true?**
- **Does any new header, log line, analytics event or URL include the `#k=` key?**

For deeper review, use the `/security-review` skill, or `/code-review` for correctness.

---

## 7. Definition of done

- Everything in the automated list in section 6 passes, and you've reported the actual output.
- If the deployment changed: `docker compose config --quiet`, then `up -d --build`, then every service healthy, then the manual checks above.
- `progress.md` has an entry: what changed, which checks ran with their results, what's unverified.
- Nothing is committed or pushed unless the owner asked. If they asked, nothing of theirs was swept into your commit.

---

## 8. Known gaps (open)

- No transfer has been tested on a real phone since the hardening; do one, and compare the security codes on both screens.
- Caddy runs as root inside its container (only `NET_BIND_SERVICE` kept).
- `disconnecting` emits `peer-left` during a recoverable blip, so the sender's screen may reset briefly.
- When the receiver's security check fails first, the sender sees "The receiver could not complete the transfer" instead of the security message.
- The server still sees file sizes (no padding).
- The legacy single-container files (`Dockerfile`, `docker/entrypoint.sh`, `docker/nginx.conf`) aren't covered by CI.
