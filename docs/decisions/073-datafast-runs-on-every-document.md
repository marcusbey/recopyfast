# ADR 073 — DataFast runs on every document, the nonce surface included

- Status: accepted (CTO decision, 2026-10-22; architect review pending on the branch)
- Date: 2026-10-22
- Scope: branch `feature/datafast-analytics`
- Related: [ADR 059](./059-nonce-csp-on-the-app-surface.md) (the two CSPs),
  [ADR 063](./063-google-analytics-on-the-marketing-surface.md) /
  [ADR 069](./069-google-analytics-document-and-consent-boundaries.md) (Google Analytics),
  [ADR 070](./070-consented-server-conversions-are-separate-from-business-totals.md)
- Narrows: ADR 070 Decision 10's "no private CSP expansion", for `https://datafa.st` only.
  Its "no Google scripts on auth/dashboard/report documents" is unchanged.

## Context

The owner relies on DataFast for traffic and signup attribution. Attribution needs the script on
the pages the funnel crosses: the marketing pages, `/signup`, `/login` and `/dashboard`. Those
last three are served under ADR 059's nonce policy with `'strict-dynamic'`, where a host
allowlist alone loads nothing; the marketing pages are prerendered under the static policy and
have no nonce. The root layout cannot read the request nonce without making every page dynamic.

## Decision

1. **One `next/script` (`afterInteractive`) in the root layout**, outside the GA consent gate
   (`src/components/analytics/DataFastScript.tsx`). Website id and domain are constants in
   `src/lib/analytics/datafast.ts`.
2. **The nonce comes from Next.** On a per-request render Next passes the nonce it parsed from the
   request CSP through `HeadManagerContext`; `next/script` stamps it on its script preload, and the
   client inserts the script from Next's own trusted runtime, which `'strict-dynamic'` admits. No
   `headers()` call, so no page changes rendering mode.
3. **`https://datafa.st` joins `script-src`/`script-src-elem` and `connect-src` on both policies**
   (`dataFast` in `buildContentSecurityPolicy`). Under the nonce the script host entry is ignored
   by CSP3 browsers and is the CSP2 fallback; `connect-src` carries the beacons to
   `https://datafa.st/api/events`.
4. **`NEXT_PUBLIC_DATAFAST_DISABLED=true` removes both** the script and the CSP origin (one
   function, `isDataFastEnabled`, decides for the layout and the middleware).
5. **No client-side goal calls.** Verified signup (s111) and purchase (s112) are recorded server
   side (confirm route, webhook, outbox); there is no single client hook point after verification,
   so DataFast goals are a separate follow-up.

## Options considered and rejected

- **Read `headers()` in the root layout and pass `nonce`:** makes every marketing page dynamic,
  which ADR 059 rejected for LCP.
- **Keep DataFast off `/signup` and `/login`:** loses the attribution the owner asked for. ADR 070
  forbids Google scripts there, not every third party.
- **Route it through the GA consent gate:** rejected by the CTO decision; DataFast is the owner's
  attribution baseline.

## Consequences

- A third-party script now runs on the documents that take credentials and render scraped text.
  It is admitted by origin and by Next's runtime only; an injected inline script is still blocked.
- `/privacy` lists DataFast as a processor.
- The CI e2e and Lighthouse builds load the real script unless they set the disable flag; DataFast
  ignores localhost, and `e2e/csp.spec.ts` checks the preload carries the nonce.
