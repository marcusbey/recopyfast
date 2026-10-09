# ADR 059 — A per-request nonce CSP on the app surface; the marketing surface stays static

- Status: accepted (CTO decision under the owner's 2026-10-09 directive)
- Date: 2026-10-09
- Scope: story s79-headers-csp-ws (s69 L1)

## Context

Production sends `script-src 'self' 'unsafe-inline'` on every page (`src/middleware.ts`), so an
injected inline script or event handler runs. The dashboard renders text scraped off customers'
pages; `/login`, `/signup` and `/edit` take credentials.

Next.js 16 stamps a nonce on its own scripts only while rendering a request: it reads the nonce
from the request's `Content-Security-Policy` header (`app-render.js`, `getScriptNonceFromHeader`).
A prerendered page has none. Nearly every page here is prerendered today, including `/` (the
LCP-sensitive landing), `/login`, `/signup`, `/edit` and most of `/dashboard`. App Router HTML
also carries inline scripts whose content is the page payload (`self.__next_f.push(…)`), different
per page and per build, so neither `experimental.sri` (external scripts only) nor a build-time
hash list removes `'unsafe-inline'` from a static page. Measured in
`docs/research/s79-headers-csp-ws.md`.

## Decision

Two policies, chosen per request by path in `src/lib/security/content-security-policy.ts`:

1. **The app surface — `/dashboard`, `/login`, `/signup`, `/edit` and everything below them —
   gets a nonce policy.** A fresh 128-bit nonce per request; `script-src` and `script-src-elem`
   are `'nonce-N' 'strict-dynamic' 'sha256-<theme script>' 'self' 'unsafe-inline'` (plus
   `'unsafe-eval'` in development). The middleware sets the same policy on the forwarded request,
   so Next stamps `N` on every script and preload. Each of those four segments has a server
   layout that awaits `connection()`, so every page under it renders per request — a page added
   later inherits it. The theme bootstrap script is allowed by its hash, computed from the one
   constant the root layout renders, so it cannot drift.
2. **Everything else keeps today's policy** (`script-src 'self' 'unsafe-inline'`) and stays
   static: `/`, `/compare/*`, `/blog`, `/docs/install`, `/privacy`, `/terms`, `/demo`, `/try`,
   the embed and the API. These pages render no user data server-side and carry three.js,
   framer-motion and lenis (marketing only, AGENTS.md).

All other directives are shared and unchanged. The CSP3 fallback (`'self' 'unsafe-inline'` after
the nonce) is ignored by browsers that understand nonces and `'strict-dynamic'`, and is what keeps
an old browser working.

## Considered options

- **Nonce everywhere, every page dynamic:** rejected. `/` and the comparison pages would lose
  static serving and the CDN, and the landing's LCP is the conversion surface. The XSS exposure
  there is low: no server-rendered user input.
- **Nonce by default, a static allowlist for marketing:** rejected. A static page missing from
  the list is not weakened, it is broken (no hydration — measured), and only in production builds
  (`next dev` renders everything dynamically). The chosen direction fails the other way: a new
  app segment outside the list keeps a working page under today's policy.
- **Build-time hashes of every inline script:** rejected. The flight scripts change per build and,
  on ISR pages, every five minutes; it needs a second build pass and a manifest the middleware
  reads at runtime.
- **`experimental.sri`:** rejected. Covers external scripts only and is experimental.
- **Leave it:** rejected. The dashboard is where an injected script would read a customer's data.

## Consequences

- The four app segments render per request. Measured locally: 3.1 ms → 5.6 ms median TTFB for an
  auth page; on Vercel they already run the Node middleware with a session lookup per request.
- `dashboard/layout.tsx` is a server component rendering the client `DashboardFrame` (s88 makes
  the same split for its metadata).
- A new inline script in the root layout must be added to the hash list or it is blocked on the
  app surface — `content-security-policy.test.ts` hashes the constant the layout renders.
- A route moving between the two lists is a decision for this ADR's successor, not a one-line
  edit: moving a static page into the nonce list breaks it unless its segment renders dynamically.

## Watch

`/blog/[slug]` renders stored HTML and is dynamic today, but s88/s89 are changing how blog pages
read their data; it stays on the static policy until that settles. No `report-to` endpoint exists;
violations surface in the browser console only (follow-up).
