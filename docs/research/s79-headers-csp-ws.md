# Research — Story s79-headers-csp-ws

Verified on `origin/main` `fc5968b` (2026-10-09), Next.js 16.3.8 (`node_modules/next/package.json`),
with a local `next build` + `next start` and read-only GETs against production. Line numbers are
`fc5968b`'s.

## 1. The CSP today (L1)

- `src/middleware.ts:245-247`: production `script-src 'self' 'unsafe-inline'`, duplicated into
  `script-src-elem` (`:295`). Live on `https://www.recopyfa.st/` (header read 2026-10-09). No
  `report-uri`/`report-to` exists anywhere — nothing to keep.
- `withSecurityHeaders` (`:230-311`) is applied to every matched response but redirects; the
  matcher (`:334`) skips `_next/static`, `_next/image`, `favicon.ico` and image files.
- The root layout renders one inline script of ours: the theme bootstrap
  (`src/app/layout.tsx:126-130`, a fixed string). It is not a Next script, so Next never stamps a
  nonce on it.

### How Next 16 applies a nonce — read in `node_modules/next`

- `next/dist/docs/01-app/02-guides/content-security-policy.md`: Next reads the nonce from the
  **request's** `Content-Security-Policy` header during server rendering and stamps it on its
  framework scripts, page bundles, inline scripts it generates and `<Script nonce>`.
- `next/dist/server/app-render/app-render.js:209-210`: `headers['content-security-policy'] ||
  headers['content-security-policy-report-only']` → `getScriptNonceFromHeader`, which takes the
  first `'nonce-…'` of `script-src`, else `default-src` (regex `^'nonce-([A-Za-z0-9+/_-]+={0,2})'$`).
  So the middleware must set the policy on the **forwarded request** (`NextResponse.next({ request:
  { headers } })`), not only on the response.
- **A nonce needs dynamic rendering.** Same guide, "Static vs Dynamic Rendering with CSP": a
  prerendered page was produced at build time, with no request, so it carries no nonce.
- **SRI is not the alternative here.** `experimental.sri` adds `integrity` to external `<script
  src>` tags only. App Router pages also carry **inline** scripts (below), so `script-src 'self'`
  without `'unsafe-inline'` would still block them. Experimental, too.

### Measured on this repo's build (`next build`, then `next start` on loopback)

- Route table: almost every page is **static** — `/`, `/login`, `/signup`, `/edit`, `/dashboard`,
  `/dashboard/sites`, `/dashboard/content`, `/dashboard/settings`, `/docs/install`, `/compare`,
  `/privacy`, `/terms`, `/demo`, `/try`; `/compare/*` are ISR (5 min). Dynamic today:
  `/blog/[slug]`, `/dashboard/billing`, `/dashboard/sites/[siteId]/*`.
- Static HTML carries 3–6 inline scripts: the theme script, React's streaming bootstrap
  (`$RB`/`$RV`/`$RT`), and Next's flight pushes `self.__next_f.push([1,"…page payload…"])`. The
  last kind differs per page and per build — so a build-time hash list cannot cover static pages
  without a second build pass, and ISR pages would invalidate it every 5 minutes. Rejected.
- **Spike (reverted):** `/login` forced dynamic by a layout awaiting `connection()`, served with
  `'nonce-N' 'strict-dynamic' 'self' 'unsafe-inline'` on the request and the response. Every
  `<script>` (17) and the `<link rel=preload as=script>` carried `nonce="N"`; Playwright saw
  hydration and **one** violation — the theme script (inline, no nonce). `/signup` left static
  under the same policy: 14 chunk loads and 3 inline scripts blocked, no hydration. So the
  e2e check (violations + hydration) bites, and a nonce route that is static is broken, not
  degraded.
- Client navigation across policies works both ways (spike): `/login` (nonce document) →
  `router.push('/')` and `/` (static document) → `/login` load their chunks and render with no
  violation other than the theme script above — chunk loading is script-created, which
  `'strict-dynamic'` trusts.
- Cost of forcing dynamic, local TTFB over 20 requests: static `/signup` median 3.1 ms, dynamic
  `/login` 5.6 ms. On Vercel these routes already run the Node middleware with `getUser()` per
  request, so the marginal cost is the shell's server render, not a new invocation. `/` is not
  touched: no change to its LCP.
- Baseline before the story (current build): `/`, `/pricing` → `/#pricing`, `/login`, `/signup`,
  `/edit`, `/docs/install`, `/compare`, `/dashboard` (→ `/login`) all hydrate with **zero**
  violations under today's policy.

### Third parties actually loaded (all same-origin or `connect-src`)

`grep` over `src/` (non-test): no `loadStripe`/`js.stripe.com` (Checkout is a redirect), no Vercel
analytics or speed-insights, no `next/script`. Fonts are `next/font/google` (self-hosted under
`/_next/static/media`). Sentry posts to the same-origin tunnel (s46). Supabase and the WS origin
are `connect-src`, derived from env (unchanged). three/R3F, framer-motion and lenis are marketing
only (AGENTS.md) and keep today's policy. JSON-LD (`type="application/ld+json"`, `/compare`) is a
data block — CSP does not govern it.

### CSP3 fallback

`'nonce-N' 'strict-dynamic' 'sha256-<theme>' 'self' 'unsafe-inline'`: CSP3 browsers honour nonce,
hash and `'strict-dynamic'` and ignore `'self'` and `'unsafe-inline'`; CSP2 browsers (no
`'strict-dynamic'`) ignore `'unsafe-inline'` because a nonce is present and load same-origin
chunks by `'self'`; CSP1 browsers fall back to `'self' 'unsafe-inline'`. `https:` (Google's
generic fallback) is not needed — every script is same-origin — so it is not added.

## 2. HSTS and the legacy header (L19, headers half)

- Nothing in the repo sets `Strict-Transport-Security`. Production: `www` and the apex's 308 both
  send Vercel's custom-domain default `max-age=63072000` (read 2026-10-09). Vercel docs
  ("Encryption → Support for HSTS"): custom domains get HSTS for the particular subdomain only,
  and "you can modify the Strict-Transport-Security header by configuring custom response headers
  in your project".
- `includeSubDomains` applies to the subdomains **of the host that sends it**. From `www` it covers
  `*.www.recopyfa.st`; each tenant host under ADR 021's `*.recopyfa.st` sends its own. The apex
  308 is Vercel's domain redirect and keeps Vercel's header — covering every `*.recopyfa.st`
  from the apex is a Vercel domain setting, not code (post-deploy note). No subdomain is served
  over plain HTTP: the app's hosts are Vercel-managed TLS, the realtime service is on `fly.dev`,
  mail records are DNS only (HSTS does not touch them). `preload` is out of scope (irreversible).
- The header must be the **same on every response**: a browser keeps the last policy it saw, so
  a static asset answering without `includeSubDomains` would switch it off again. The middleware
  matcher skips `_next/static`; `next.config.ts` `headers()` `source: '/(.*)'` does not. Next
  config headers merge with middleware headers (measured: the middleware's `Referrer-Policy`
  wins over the config's for the same key, so the HSTS key must live in exactly one place).
- `X-XSS-Protection` (`src/middleware.ts:234`) is deprecated; `1; mode=block` can introduce
  cross-site leaks in old engines. Removing it is the current guidance.
- `docs/operations/deployment-checklist.md:24-25`: the first 17 characters after `sk_live_` and
  `pk_live_` of the real keys. That prefix is the account id (also inside every publishable key
  served to browsers), so it is hygiene, not a leak; no other occurrence in the tree.

## 3. The fidelity harness (L8)

- `public/embed/__fidelity__/{index.html,harness.js}`; production
  `GET /embed/__fidelity__/index.html` → 200 (2026-10-09). `index.html:366-409` builds
  `<script src>` from `?widget=`, so any URL runs on `www.recopyfa.st`.
- No test, script, workflow or living doc references it: `grep -rn fidelity` hits only the two
  files themselves and historical research/review records (s08, s68b, s72), which are left as
  history. It is a manual tool: open the page next to a dev server, read the result table.

## 4. The realtime service (L13, L14, rotation)

Confirmed live (2026-10-09): `GET https://recopyfast-ws.fly.dev/health` with `Origin:
https://evil.example` → `x-powered-by: Express`, `access-control-allow-origin: *`,
`{"status":"ok","connections":1,"supabase":"connected","message":"All systems operational"}`.

- `/health` consumers: Fly's check (`server/fly.toml` `[[http_service.checks]]`, `GET /health`,
  any 2xx), s84's uptime workflow (`scripts/uptime-check.mjs` on its branch: 2xx, body never
  read), and the app's `checkRealtime` (`src/app/api/health/route.ts:214-277`: `response.ok`,
  then `payload.connections ?? 0` relayed as `details`). s84 deletes that relay; until it lands
  the app would show `connections: 0`, which leaks nothing. Left to s84 to avoid a conflict on
  the same lines.
- The only Express route is `/health`; `/socket.io/` is answered by engine.io before Express, with
  its own CORS (`origin: true`, echo, no credentials) — the per-site domain pin is what
  authorises, so that layer is unchanged. Nothing browser-side reads `/health`, so no CORS at all
  is the answer there; `cors` is still installed through engine.io, so dropping our direct
  dependency changes no installed package.
- Helmet vs. a fixed header set: one JSON route, no HTML. A ten-line middleware with a test
  pinning each header gives the same result without a new dependency in a service whose
  dependency tree is a CI gate (`server-security.yml`, `npm audit --omit=dev --audit-level=moderate`)
  and whose lockfile s84 is also changing.
- **L14 order.** `server/index.js:219-245`: `siteId` check → `checkConnection` (per-site 120/min,
  then per-site-per-address 40/min) → token presence → `sites` lookup + HMAC + origin pin → grant.
  The per-site bucket is the one an unauthenticated flood exhausts.
- **Client address on Fly.** `socket.handshake.address` is the TCP peer — fly-proxy's address,
  shared by every client, so the existing per-address bucket collapses into a second per-site
  bucket in production. Fly docs (`/docs/networking/request-headers/`): `Fly-Client-IP` is "the IP
  address of the client from the perspective of Fly Proxy" and is the recommended choice over
  `X-Forwarded-For` (spoofable) when no other proxy sits in front. Machines are reachable only
  through fly-proxy or the private 6PN network. `FLY_APP_NAME` is set on every Machine
  (`/docs/machines/runtime-environment/`), so it is the switch for trusting the header; off Fly a
  client could send it, so it is ignored there.
- **Rotation.** `POST /api/sites/[siteId]/regenerate-snippet` (admin-only, rate-limited) writes a
  new `sites.api_key` in one statement; every token signed by the old key fails `verifySiteToken`
  from then on. The WS server learns nothing. Options weighed (decision in the plan): re-verify on
  the existing 60 s sweep + on the message paths that already re-resolve (chosen); per-message
  only (misses silent sockets); a Redis pub/sub revocation channel (a new cross-service contract
  and a second Redis use on the shared Upstash, for a window that is a minute today); an internal
  HTTP callback (a new secret and endpoint).
- The widget opens a socket for **every** visitor when `data-ws-url` is set
  (`recopyfast.src.js` `establishConnection`), so viewer sockets exist in numbers. The sweep must
  read `sites` once per site, not once per socket. Viewer sockets receive nothing today (the only
  broadcasts go to `site:{id}:staging` and `dashboard:{id}`), so dropping one costs nothing; the
  widget does not auto-reconnect after a server disconnect.

## Traps

1. A nonce route that is prerendered is **broken** (no hydration), not weakened — the forcing
   must live in the segment layout so a page added later inherits it.
2. A client layout cannot force dynamic rendering (no `connection()`, no segment config in a
   `"use client"` module): `dashboard/layout.tsx` has to become a server layout around a client
   frame — the split s88 also makes.
3. Adding a hash or nonce to the **static** policy would make browsers ignore its
   `'unsafe-inline'` and break every static page. The theme hash belongs to the nonce policy only.
4. HSTS set in two places can disagree; set it once, where static assets get it too.
5. Express `x-powered-by` is per-app (`app.disable`), not a header to delete per response.
6. The pre-auth bucket must key on the real client address, or behind fly-proxy it is one global
   bucket and a flood locks out everyone instead of one site.

## 5. Recovery findings (2026-10-10)

These findings post-date the 2026-10-09 research and are kept separate from that snapshot:

- A browser keeps the CSP of its current document across an App Router client navigation. A
  marketing-document `<Link>` to `/signup` or `/dashboard` renders the destination under the
  marketing policy until a full document load. This is an accepted limitation of ADR 059's
  split, not a reason to rewrite the accepted ADR: auth callbacks are full redirects, and changing
  navigation behavior needs a separately validated plan. The canonical current-state note is in
  `docs/architecture.md`.
- Unknown URLs below a nonce segment were served by static `/_not-found`, whose scripts had no
  nonce and did not hydrate. Segment-local `[...missing]/page.tsx` catch-alls make those 404s pass
  through the segment's `connection()` layout and render per request.
- A full IPv6 address is not a stable limiter identity because one subscriber commonly owns a
  `/64`. The address bucket groups valid IPv6 by `/64`, keeps IPv4 (including hexadecimal and
  dotted IPv4-mapped IPv6) per address, and fail-closes malformed input into one `unknown` bucket.
- `content-map` compared only the message token with the socket's handshake token. Those two old
  values still agreed after key rotation, so it could fan out URL/count metadata until the sweep.
  It now reuses `revalidateSocket` before fan-out, at the cost of one bounded `sites` read.
- `server/security-headers.js` is Express middleware. Engine.IO answers `/socket.io/` before
  Express, so its own response headers and CORS were never covered by s79 and remain unchanged.
