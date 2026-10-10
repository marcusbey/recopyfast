---
validated: yes
---
# Plan — Story s79-headers-csp-ws

> CTO decision under the owner's 2026-10-09 directive ("don't ask me questions; take CTO-level
> decisions; implement everything left; test everything"): plan validated by the orchestrator.

Branch: `feature/s79-headers-csp-ws` (planned from `origin/main` `fc5968b`; recovered and integrated
on current `origin/main` `0dea1c0` on 2026-10-10).
Research: `docs/research/s79-headers-csp-ws.md` — read it first; this plan does not repeat it.
Decision: ADR 059. No new screen and no visible change, so no Design step. No migration. Embed
allocation: 0 bytes (`public/embed/recopyfast.src.js` untouched).

## CTO decisions

1. **CSP: nonce on the app surface, today's policy on the static marketing surface** (ADR 059).
   Nonce routes: `/dashboard`, `/login`, `/signup`, `/edit` and below, each forced dynamic by a
   server layout awaiting `connection()`. Fallback for old browsers: `'self' 'unsafe-inline'`
   after the nonce (no `https:` — every script is same-origin). The theme script is allowed by a
   hash computed from the constant the root layout renders. No `report-to` is added (none exists;
   follow-up).
2. **HSTS once, in `next.config.ts` `headers()` for `/(.*)`**: `max-age=63072000;
   includeSubDomains`, no `preload` — config headers reach `_next/static`, which the middleware
   matcher skips, and a browser keeps the last policy it saw. `X-XSS-Protection` removed.
3. **Fidelity harness → `e2e/fixtures/embed-fidelity/`**, served by a dependency-free
   `scripts/serve-embed-fidelity.mjs` bound to 127.0.0.1 that answers exactly three paths.
4. **Realtime HTTP surface: a fixed header set, not helmet** — one JSON route; no new dependency
   in a CI-audited tree whose lockfile s84 also changes. No CORS middleware at all (nothing
   browser-side reads `/health`); the `cors` direct dependency goes (engine.io still installs it).
   `/health` answers `{"status":"ok"}` with `no-store`. Socket.io's own CORS is unchanged.
5. **Handshake order:** `siteId` check → **pre-auth per-address bucket** (new,
   `maxHandshakesPerAddress` 60/min, fail closed) → token presence → `sites` lookup, HMAC, origin
   pin → **per-site buckets** (unchanged values) → grant. The address is `Fly-Client-IP` when the
   process runs on Fly (`FLY_APP_NAME` set), else the TCP peer. Residual, accepted: a holder of
   the public token who forges `Origin` from three or more addresses can still spend a site's 120
   — that is what the per-site cap is for.
6. **Rotation closes sockets via the existing sweep**, not a pub/sub channel: every socket's
   site token is re-verified against the current `sites.api_key` on the 60 s sweep (one `sites`
   read per site per sweep, shared by its sockets) and on the message paths that already
   re-resolve (`content-update`, `join-dashboard`). A missing row or a token that no longer
   verifies → `auth-error` "Site token revoked", disconnect; a failed read → "Site verification
   failed", disconnect (fail closed, as the grant re-resolution already does). Closes ADR 027's
   follow-up with the test it asks for; no new ADR (ADR 027 named this option).
7. **Not touched, on purpose:** `src/app/api/health/route.ts` (s84 removes its `details` relay —
   same lines), `/blog/[slug]` (s88/s89 are changing it; ADR 059 "Watch"), socket.io's
   `cors.origin`, engine.io's own responses.

## Task 1 — the policy module

`src/lib/theme/theme-init-script.ts` exports `THEME_INIT_SCRIPT` (the root layout's string,
verbatim). `src/lib/security/content-security-policy.ts` exports `NONCE_POLICY_PATH_PREFIXES`,
`usesNoncePolicy(pathname)`, `createCspNonce()`, `THEME_INIT_SCRIPT_HASH`,
`buildContentSecurityPolicy({ nonce?, isDev, env })` (connect-src derivation moved verbatim from
the middleware). Red first, in `src/lib/security/__tests__/content-security-policy.test.ts`:
static policy in production is exactly today's `script-src 'self' 'unsafe-inline'` with no nonce,
hash or `'strict-dynamic'`; the nonce policy's `script-src` and `script-src-elem` are
`'nonce-N' 'strict-dynamic' '<hash>' 'self' 'unsafe-inline'` (+ `'unsafe-eval'` in dev); the hash
is the base64 SHA-256 of `THEME_INIT_SCRIPT`, computed in the test; nonces are 128-bit base64,
match Next's nonce regex, differ across calls; prefix matching respects segment boundaries
(`/login` yes, `/loginx`, `/editor`, `/edit-x`, `/api/edit` no); the theme script reads
`THEME_STORAGE_KEY`; connect-src keeps its env-derived origins.

- [x] Task 1

## Task 2 — the middleware applies it

`src/middleware.ts`: per request, `usesNoncePolicy` → nonce or not; the same policy string goes on
the response and, for a nonce route, on the forwarded request (`NextResponse.next({ request: {
headers } })`, built at call time so a refreshed session cookie is still forwarded); drop
`X-XSS-Protection`. Red first in `src/__tests__/middleware-csp.test.ts`: `/login` and a signed-in
`/dashboard` carry a nonce policy whose forwarded request header equals the response header;
two requests, two nonces; the Supabase cookie-refresh path (`setAll`) keeps the request policy;
`/`, `/pricing`, `/embed/recopyfast.js` keep the static policy and forward no policy; no response
has `X-XSS-Protection`. Declared test change: `middleware-matcher.test.ts` drops
`X-XSS-Protection` from its two "same header set" lists (the header no longer exists);
`security/headers-cors.test.ts` drops it from its literal list.

- [x] Task 2

## Task 3 — the nonce segments render per request

`src/app/dashboard/layout.tsx` → server layout: `await connection()`, render `<DashboardFrame>`;
`src/app/dashboard/DashboardFrame.tsx` is the old client layout moved verbatim (named export).
New `src/app/{login,signup,edit}/layout.tsx`: `await connection()`, return children. Root layout
renders `THEME_INIT_SCRIPT`. Red first in `src/__tests__/security/nonce-routes-render-dynamically.test.tsx`:
for every `NONCE_POLICY_PATH_PREFIXES` entry, the segment's layout module exists, awaits
`connection()` (mocked) before resolving, and renders its children (the dashboard through
`DashboardFrame`). Declared test change: `design/page-shell-guard.test.ts` `FOCUS_SHADOW_FILE` →
`DashboardFrame.tsx` (the skip link moved with the frame). Review recovery adds one
`[...missing]/page.tsx` per nonce segment and declares the page-shell guard's narrow `notFound()`
exemption, so unknown URLs also render below the dynamic layout. Build: the route table shows the
four segments and their catch-alls as `ƒ` and `/` still `○`.

- [x] Task 3

## Task 4 — HSTS with includeSubDomains

`next.config.ts` `/(.*)` block: `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
Red first in `src/__tests__/next-config-hsts.test.ts`: the catch-all block carries it, with
`includeSubDomains`, `max-age` ≥ one year, and no `preload`.

- [x] Task 4

## Task 5 — no live-key account prefix

Red first: `src/__tests__/security/no-live-key-prefixes.test.ts` scans tracked text files
(`git ls-files`, minus binaries and lockfiles) for `(sk|pk|rk)_live_5<digit>…` (the shape of a
real key; placeholders such as `pk_live_placeholder…` do not match). Then
`docs/operations/deployment-checklist.md:24-25` → `sk_live_...` / `pk_live_...`.

- [x] Task 5

## Task 6 — the fidelity harness leaves `public/`

`git mv public/embed/__fidelity__/{index.html,harness.js} e2e/fixtures/embed-fidelity/`; paths in
`index.html` (`./harness.js`, default widget `/embed/recopyfast.js`, the `head.js` A/B note) and
the harness header comment updated. `scripts/serve-embed-fidelity.mjs`: `node:http` on
127.0.0.1 (`FIDELITY_PORT`, default 4321), answers `/` (the fixture), `/harness.js`,
`/embed/recopyfast.js` (the current artifact from `public/embed/`) and `/head.js` when present;
404 otherwise. Red first in `src/__tests__/embed/fidelity-harness-not-public.test.ts`: nothing
under `public/` is named `__fidelity__` and no file there builds a script from a `widget` query
parameter; the fixture exists at its new path; the script, started on port 0, serves the three
paths, refuses a traversal and listens on loopback only.

- [x] Task 6

## Task 7 — the realtime HTTP surface

`server/security-headers.js` (fixed set: `nosniff`, `X-Frame-Options: DENY`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy:
no-referrer`, HSTS as Task 4, `Cross-Origin-Resource-Policy: same-origin`); `index.js`:
`app.disable('x-powered-by')`, the header middleware first, no `cors()`, `/health` →
`no-store`, `{ status: 'ok' }`. `cors` removed from `server/package.json` and its lock root
(`npm uninstall --package-lock-only` in `server/`; `node_modules/cors` stays, engine.io's).
Red first in `server.integration.test.ts` ("the HTTP surface"): with a socket open, `/health` is
200 `{"status":"ok"}` exactly and `no-store`; no `x-powered-by`; no ACAO on GET or OPTIONS with
a foreign `Origin`; each header present; an unknown Express path's 404 carries them too. Engine.IO
answers `/socket.io/` before Express and its response headers remain outside this task.

- [x] Task 7

## Task 8 — verify before the per-site bucket

`rate-limit.js`: `maxHandshakesPerAddress` (60) and `checkHandshake({ address })`
(`conn-pre:<address>`); `checkConnection` unchanged. `index.js`: `resolveClientAddress(handshake,
{ trustFlyClientIp })`, the order of CTO decision 5, factory option `trustFlyClientIp`
(default false), `startFromCli` passes `Boolean(process.env.FLY_APP_NAME)`. Harness: `openSocket`
accepts extra headers. Red first in `server.integration.test.ts`: with `maxConnectionsPerSite: 2`,
three bad-token handshakes, then a valid one is admitted (old code: refused, "Rate limit
exceeded"); with `maxHandshakesPerAddress: 2`, the third bad handshake from one address is refused
before any `sites` read, and another `Fly-Client-IP` is admitted when trusted; untrusted, two
`Fly-Client-IP` values share one bucket. Declared test change: "spends no database round trip on
a connection it has already refused" now caps `maxHandshakesPerAddress: 0` — the per-site cap
moved behind verification by design. Review recovery groups IPv6 identities by `/64`, preserves
IPv4 and IPv4-mapped addresses per host, and sends malformed values to one `unknown` bucket;
focused unit and handshake tests cover all three shapes.

- [x] Task 8

## Task 9 — rotation closes live sockets

`index.js`: `revalidateSocket` first re-verifies `socket.data.siteToken` against the current key
(`verifySiteToken`), then the grant for staging sockets; the sweep (`revalidateAll`, also
returned by the factory) visits every authenticated socket and reads `sites` once per site per
pass. Red first in `server.integration.test.ts` ("key rotation reaches a live socket"): a viewer
socket is dropped with "Site token revoked" by the next sweep after the key changes, and a socket
signed with the new key is admitted (ADR 027's test); an editor's next `content-update` is
refused and not broadcast; a deleted site drops its sockets; a failing `sites` read drops them
(fail closed); ten sockets on one site cost one `sites` read per sweep; a valid viewer survives
sweeps (existing test). Review recovery applies the same current-key check to `content-map`
before it can fan out URL/count metadata. Declared existing-test changes: the security projection
allowlist admits the new service-role-only `sites.select("id, api_key")`; three revocation tests
use the harness's `refused()` result instead of observing `socket.disconnected`, which may already
be true before the client receives the preceding `auth-error`.

- [x] Task 9

## Task 10 — the browser proof

`e2e/csp.spec.ts` (+5): (1) `/` and `/pricing` → `/#pricing` hydrate with no violation, under the
static policy, with the HSTS header and without `X-XSS-Protection`; (2–4) `/login`, `/signup`,
`/edit`: two responses carry different nonces, every `<script>` and script preload in the HTML
but the theme script carries the header's nonce, the page hydrates with no violation; (5) a
signed-in owner (`owner-session.ts`, CI's disposable stack) loads `/dashboard` and
`/dashboard/sites/<id>` under the nonce policy with no violation. Violations are collected from
`securitypolicyviolation` (init script) and console. On the integrated base the contract is
86 → 91 in `playwright.config.ts`, every place in `.github/workflows/ci.yml` and
`src/__tests__/e2e/playwright-ci-contract.test.ts`.
PR #85 extends the existing marketing case without changing that count: a harmless inline handler
runs on the static document, the actual Hero and Header auth links each produce a new document
response with a fresh nonce, the handler is blocked there, and `/signup` → `/login` still works as
an app-internal client transition.
Run (1)–(4) locally against `next build` + `next start` (`CI=1`, `PLAYWRIGHT_BASE_URL`); (5) is
CI's.

- [x] Task 10

## Task 11 — docs

`docs/architecture.md` (Two deploy targets: `/health` shape; CSP section: the two policies,
HSTS, pointers by symbol), `server/README.md` (Verify `/health`, HTTP surface, handshake order,
rotation sweep, `FLY_APP_NAME`), `server/fly.toml` header pointers by symbol, ADR 059,
s69 stub marks. Review recovery records that CSP is document-scoped. PR #85 replaces the earlier
agent-authored "accepted limitation" note with the enforcement mechanism: native anchors only at
static-to-app boundaries, app-internal client navigation unchanged. ADR 059 stays untouched because
accepted ADRs are immutable; this repair implements its existing app-surface policy.

- [x] Task 11

## Task 12 — gates, mutations, cleanup

Mutations (neutralise → red → restore with `git checkout -- <file>`): nonce on the request
header; theme hash; one layout's `connection()`; HSTS `includeSubDomains`; the pre-auth bucket;
per-site after verification; the sweep's token re-check; `/health` body; `x-powered-by`; the
fidelity guard. Gates: full jest (CI env), `type-check`, `type-check:build`, `lint`,
`format:check`, `build:embed -- --check`, `next build` (route table), Playwright `--list` = 91.
The integrated base's stricter Next lint also required two declared neutral repairs: document-load
account links in `DashboardFrame` keep their `<a>` behavior with a narrow rule suppression and CSP
rationale, while the generic badge component's navigation fixture uses an in-document hash instead
of pretending to own the real `/dashboard` route. Delete `.next`, `test-results/`,
`playwright-report/`.

- [x] Task 12

## PR #85 automated-review repair (2026-10-10)

Human-authorized fix mode after the validated plan and first review; the frontmatter remains the
historical validation of Tasks 1–12, not a claim that these later findings were in that checkpoint.

- [x] The app's realtime probe consumes s79's status-only `/health` contract as liveness and
  reports status/latency only—no fabricated connection count or Supabase mode. The health test
  double now returns the real `{ status: "ok" }` shape and asserts `details` is absent.
- [x] Every static/marketing entry into the nonce surface uses a native anchor, preserving the
  existing href, query and hash semantics plus ordinary modifier-key/accessibility behavior. The
  shared Header no longer mounts owner auth forms under the marketing policy. A source guard covers
  the finite boundary inventory; the existing CSP browser case proves the Hero and Header paths
  load nonce documents, blocks the harmless inline probe there, and keeps app-internal navigation.

## Rollout

Vercel deploy (app) and `cd server && fly deploy` (realtime) are independent; either order works.
After deploy: browser console on `/`, `/#pricing`, `/login`, `/signup`, `/edit`, a signed-in
`/dashboard` and a site page — no CSP error; `curl -sI https://www.recopyfa.st/login` shows a
`'nonce-…'` that changes per request and HSTS with `includeSubDomains`; `curl -s -D -
https://recopyfast-ws.fly.dev/health` shows `{"status":"ok"}`, no `x-powered-by`, no ACAO; the
marker probe in `server/README.md`. The apex 308 keeps Vercel's HSTS until the domain setting is
changed (research §2).
