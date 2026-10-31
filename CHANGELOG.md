# Changelog

All notable changes to Via are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-31

### Added

- **Short receive links.** The sender now shares a four-digit link such as
  `https://host/1234#k=…`. Redis maps the code to the session UUID, the key
  still travels only in the fragment, and legacy `/receive/<uuid>` links keep
  working. Codes are released on completion, cancel or leave, and reused;
  creating a session fails clearly if all 10,000 codes are in use. Short-code
  lookups are limited to 15 per minute per client IP.
- **Host-only admin console.** `http://127.0.0.1:8081/config` signs in with
  `admin` / `admin` (forced change), then edits short-link mode and length,
  session TTLs, limits and STUN/TURN URLs. Settings persist in the `settings`
  Docker volume. The public site returns 404 for `/config` and the admin API,
  and the loopback listener is the only path that can reach them.
- **Dynamic short links.** The admin page can switch from four numeric digits
  to 4–6 lowercase alphanumeric codes. Existing links keep resolving after a
  mode change.

### Changed

- **Rebuilt send and receive pages.** Both now show a three-step tracker,
  a single file card with status, progress and actions together, and
  consistent buttons. The footer no longer overlaps content on short screens.
- **Dependencies updated** to their latest releases, including React 19.3,
  Vite 8, ESLint 10, TypeScript 7 (backend) / 6.0 (frontend), Redis client 6,
  dotenv 18 and lucide-react 1.x. The frontend image now builds on Node 24.
- **Backend dev server** runs on `tsx watch`; nodemon, ts-node, ts-node-dev
  and the stub `@types/pino-http` and `@types/socket.io` packages are gone.
- **CI and Dependabot** moved to the repository root, where GitHub actually
  runs them; each workflow runs only when its app changes.

### Fixed

- The receive page lost the file card while waiting for the sender to start
  (the `requesting` stage).
- A receiver whose link key cannot decrypt the file details now stops
  straight away and keeps the "couldn't be decrypted" message, instead of
  connecting anyway and showing the sender's generic error.
- End-to-end tests: Chromium's mDNS host candidates stalled every transfer
  on macOS; the mock server now answers `ice-servers` like the real one; the
  storage-quota test now uses a browser without a save picker.

## [1.0.0] - 2026-10-29

The first stable release: a complete, hardened home-network deployment with
resumable direct transfers and a fallback relay.

### Added

- **Resumable transfers.** A dropped WebRTC data channel is renegotiated and
  the transfer resumes from the receiver's last confirmed byte.
- **Integrity recovery.** The receiver verifies the byte count and CRC32
  checksum, and can request a fresh copy without restarting the session.
- **Direct-to-disk receiving** through the File System Access API, with an
  OPFS or in-memory fallback (capped at 512 MB) and a download for browsers
  without a save picker.
- **Free-space check** before the sender starts, using
  `navigator.storage.estimate()`.
- **Fallback TURN relay.** The Compose stack now runs coturn on the edge
  network, minting short-lived credentials per session. It relays only
  DTLS-encrypted packets and cannot reach Docker, loopback or link-local space.
- **Automatic LAN detection.** `scripts/start.sh` and `scripts/detect-lan-ip.sh`
  find the host address, rewrite `LAN_IP` in `.env`, and start Compose.
- **Configurable session lifetimes:** `SESSION_TTL_SECONDS`,
  `REFRESH_SESSION_TTL_SECONDS`, `SESSION_MAX_LIFETIME_SECONDS`,
  `SESSION_EXPIRY_WARNING_SECONDS` and `COMPLETED_SESSION_TTL_SECONDS`.
- **Optional server-side file-size cap** through `MAX_FILE_SIZE_BYTES`.
- **Receiver-tab reclaim tokens** in `sessionStorage`, so a refreshed receiver
  can recover its slot before the transfer starts without letting a third peer
  in.
- **Refreshed interface:** aurora background, file-details card, clearer
  status and progress lines, and a shared 6-digit security code.
- New integration tests for completed-session TTL, file-size configuration and
  session integrity, plus frontend tests for storage, constants and the
  receiver token.

### Changed

- `transfer-start` is now receiver-only, matching `transfer-complete`; the
  server relays the stored file name on completion.
- A completed transfer shortens the session TTL and notifies both peers.
- Redis session writes are guarded by `EXISTS` checks inside Lua scripts, so a
  hash can never be recreated without a TTL.
- Session IDs are validated as server-issued UUIDs.
- The split Compose stack is the supported deployment; the single-container
  Dockerfile remains available as a variant.
- The deployment documentation now covers coturn, `TURN_SECRET`, firewall
  ports, browser differences and the LAN detection script.

### Fixed

- Session cleanup now survives recoverable Socket.IO disconnects and releases
  the per-peer slot correctly.
- Expiry timers are rescheduled when a session's TTL changes.
- Payload validation and size caps stay aligned between the backend and the
  frontend.

### Security

- The link key remains confined to the URL fragment and is never sent to the
  server.
- Both peers verify an HMAC over their DTLS fingerprints before any data-channel
  frame is acted on.
- File metadata is encrypted with AES-GCM before the server stores it.
- Foreign origins are refused on every transport, including WebSocket, and no
  CORS credentials are used.
- Per-socket and per-IP rate limits apply to every event, with disconnects after
  repeated refusals.
- Containers remain read-only, non-root where possible, capability-limited and
  memory- and process-capped.

[1.0.0]: https://github.com/Harshsanket/via/releases/tag/v1.0.0

[1.1.0]: https://github.com/Harshsanket/via/releases/tag/v1.1.0
