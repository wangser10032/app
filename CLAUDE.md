# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Always reply to the user in Chinese (简体中文).**

## What this is

ResiHub: a small-scale **static residential proxy** sales platform. It sells a fixed number of IPs for a set rental period, with no traffic or bandwidth billing. It covers email accounts, Alipay/WeChat recharge into a balance, purchase and renewal orders, a ledger, exclusive fixed-IP leases, a user frontend, an admin panel, and an HTTP proxy gateway. Docs and UI strings are in Chinese.

The project began as a traffic-package model, and that model is **retired**. `docs/CONTRACT.md` is historical only. The current API and business rules are in `docs/STATIC-CONTRACT.md`. The legacy tables (`packages`, `entitlements`, `proxy_keys`, `usage_records`) remain only to preserve history. `/api/packages` returns 410, and old frontend routes redirect to `/app/static`. Do not revive traffic or byte billing, random rotation, or failover to another IP.

## Running and testing

Everything runs inside the Linux dev container `resihub-dev` (Node 20 / Debian 12). The repo is bind-mounted at `/workspace`, and the `node_modules` directories are Linux named volumes. On the Windows host they are empty, and `better-sqlite3` is a native module, so **do not run npm or node on the host**. Run them through the container instead:

```powershell
.\deploy\dev.ps1 up | restart | logs | shell | ps | down | doctor   # Windows (Linux host: sh deploy/dev.sh ...)
```

```bash
docker exec resihub-dev sh -lc 'cd /workspace/server && npm test'                          # all server tests
docker exec resihub-dev sh -lc 'cd /workspace/server && node --test test/gateway.test.js'  # one test file
docker exec resihub-dev sh -lc 'cd /workspace/server && node --test --test-name-pattern="renew" test/integration.test.js'
docker exec resihub-dev sh -lc 'cd /workspace/web && npm run build'     # tsc --noEmit + vite build (same for admin/)
docker exec resihub-dev sh -lc 'cd /workspace/server && npm run backup -- /workspace/server/data/backups/x.db'
```

Container startup runs `deploy/run-dev.sh`. It runs `npm ci` only when a lockfile hash changes, then `scripts/initialize-local.js`, then builds `web/` and `admin/`, then runs `node src/index.js`. Frontend changes therefore need a rebuild or a `restart` before they show on :8080. Optional Vite dev servers run on 5173/5174, but you must start them manually.

Local URLs: the user app is at http://127.0.0.1:8080/, the admin panel at `/admin/`, and the proxy gateway at `127.0.0.1:3128`. Admin credentials are in the git-ignored `.local/ACCESS.md`. There is no lint setup. The project directory is not a git repo.

## Architecture

**One Node process** (`server/src/index.js`) serves the Express API, the static `web/dist` (SPA fallback), `admin/dist` under `/admin`, and the mock payment cashier at `/mock/pay/:no`. The same process also starts the proxy gateway (`src/gateway/start.js`) on `GATEWAY_PORT`.

**Server (CommonJS, plain JS):**
- `config.js` loads `server/.env` at require time. With `NODE_ENV=production` it refuses to start unless it has real SMTP, `PAYMENT_MODE=real`, HTTPS URLs, strong secrets, and so on.
- `db/index.js` opens SQLite (WAL) when the module is first required and is a process-wide singleton. It applies `schema.sql`, which is all `CREATE ... IF NOT EXISTS`. Then it runs **additive migrations inline** (column checks plus `ALTER TABLE`) and seeds the admin on an empty database. A new column on an existing table must be added there, not only in `schema.sql`. Migrations must preserve financial history.
- `routes/*` are thin. Wrap handlers with `route()` from `utils/errors.js`, throw via `fail(status, CODE, '中文消息')`, and validate input with zod (`utils/validation.js`). The global error handler formats every error as `{ error: { code, message } }` and hides details on 5xx responses. PATCH schemas must not reuse create schemas that have `.default()`s.
- `services/ledger.js` `addLedger` is the **only** way to change `users.balance_cents`. It writes a ledger row with `balance_after_cents` and forbids a negative balance. All money is integer cents.
- `services/static-rentals.js` holds the core business logic. `purchase` and `renew` are each a single `db.transaction`: they check stock, debit the balance, write the order and ledger rows, and allocate an exclusive `ip_pool` node or extend the lease. Both require an `Idempotency-Key` header, stored as `orders.request_key`. Lease passwords are stored twice: as a bcrypt hash for gateway auth, and AES-256-GCM encrypted with `PROXY_CREDENTIAL_SECRET` so users can view them. Rotating that secret makes existing credentials unreadable. It is independent of `JWT_SECRET`. Expiry is applied lazily by `expireRentals()` before reads.
- `services/recharge.js` + `services/payments/`: `PAYMENT_MODE=mock|real`. Mock mode issues an HMAC-tokened cashier URL. Real mode uses the Alipay RSA2 and WeChat Pay V3 Native implementations. `markRechargePaid` is idempotent, and only verified provider callbacks or an admin `manual` reconciliation may credit a closed order. See `docs/PAYMENTS.md`.
- Gateway: one port serves HTTP proxy (plain and CONNECT) and SOCKS5 (CONNECT only). A `net` server sniffs the first byte. `0x05` means SOCKS5 and goes to `handleSocks`. Anything else is handed to an internal `http.Server` via `emit('connection')` followed by `socket.emit('data', firstChunk)`, because the HTTP parser reads the native handle and never sees `unshift`ed data. Both paths share `authorize()` (rate limit, lease checks, per-user connection cap) and `bridge()`. Auth uses the lease credentials `sip_<20 hex>:<secret>`. It always forwards to the lease's bound upstream node (HTTP or SOCKS5), with no failover. It enforces per-user connection limits and per-IP auth rate limits, blocks private and reserved targets after DNS resolution (`gateway/network.js`), and re-checks lease, user, and node validity on every chunk and every 500 ms, so tunnels close on expiry or disable. After 5 consecutive upstream failures, the node is auto-disabled. See `docs/GATEWAY.md`.
- Recharge / cashier flow: `POST /api/me/recharges` → `createRecharge` → `payments.createPayment` stores `pay_url`/`qr_content` on the row. The web `RechargePage` renders `qr_content` as a QR code (`qrcode`) and polls `GET /api/me/recharges/:no` every 2.5 s; balance is credited **only** by the server-side notify (`/api/payments/{alipay,wechat}/notify`) or mock confirm, never by the browser return. Mock mode: `qr_content` = `/mock/pay/:no?token=<HMAC>` (page in `routes/mock-pay.js`, disabled in real/production). Real mode: Alipay `alipay.trade.precreate` / WeChat V3 Native return a QR string; there is no hosted cashier page. Notify URLs are built from `PUBLIC_BASE_URL`, so it must be the public HTTPS domain. PEM settings accept inline PEM or a file path (relative paths resolve from `server/`; prod mounts `deploy/secrets` at `/run/secrets`). A channel lacking full config is shown disabled and never falls back to mock.
- `GET /api/ip` (`services/ip-lookup.js`) returns the visitor's own IP plus location for the landing page's "你当前的 IP" card. It uses ipinfo.io with ipapi.co as fallback, caches results in memory for 6 h, and skips lookup for private addresses. It relies on `TRUST_PROXY` to read the real client IP behind Nginx.
- `MAIL_MODE=mock` logs verification codes and returns `dev_code` in API responses.

**Frontends** (`web/` user app, `admin/` admin panel): React 18, TypeScript, react-router 7, and Tailwind, with hand-written CSS files. Both call `/api` through a small `api()` helper, with the JWT in `localStorage` (`resihub_token`). `build.mjs` forces `NODE_ENV=production`. In `web/`, `/` is the public landing page (`landing.tsx`) and `/login|register|forgot` is a split-card `AuthPage`. Both are styled only by `landing.css` (prefix `rh-`, scoped tokens, motion opt-in under `prefers-reduced-motion: no-preference`) and share `world-map.tsx` (flat SVG map on the sign-in panel); the landing hero uses `globe.tsx` (canvas orthographic globe, drag to rotate, paused off-screen). Headings use self-hosted Noto Sans SC 700/900 (unicode-range slices, so `web/dist` is ~13 MB but browsers fetch only used glyphs). That component renders the dot map from `world-dots.ts`, pre-generated from world-atlas, with no runtime map dependency, and draws real product countries or unlabeled sample exits. Don't invent stats or claim coverage in marketing copy; pricing reads live `/api/static-products`. Code there is written in a very dense style, with many components per file and long single lines; match it when editing.

## Tests

Tests use `node:test` with `--test-concurrency=1`. Because `config` and `db` are singletons that read `process.env` at require time, each test file sets `process.env` (`DB_PATH` pointing to a temp directory, `PAYMENT_MODE=mock`, `MAIL_MODE=mock`, and so on) **before** requiring anything under `src/`. Integration tests start `app` on port 0 and call it with `fetch`. Gateway tests run local fake upstreams. Follow the same pattern for new test files.

## Constraints to keep

- The code must run on Linux in production (`deploy/Dockerfile`, `docker-compose.prod.yml`, Caddy; see `deploy/README.md`). Use `path.join`, with no Windows-only paths or shell assumptions.
- No fake inventory: never seed demo IPs or present the server's own egress as residential stock. Available stock is computed from real, unallocated, active `ip_pool` rows.
- A lease exclusively holds its node until it expires, even if disabled. Allocated nodes cannot have their address, protocol, or upstream auth changed, and nodes with rental history cannot be deleted. An expired lease whose IP has been reallocated cannot be renewed.
- Admin and list endpoints must never return lease passwords, hashes, ciphertext, or upstream credentials to users.
- The owner will wire up real payment channels, mail and admin records incrementally, one at a time. Don't add global "mock environment" banners or push to switch everything to real at once. The mock cashier page itself stays labeled as mock.
