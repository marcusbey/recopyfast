# Review — s46-sentry-wiring

Reviewer: fresh-context `reviewer` subagent, 2026-09-27, diff `ef0fae6...HEAD` (72376c8, 535cc09).
Behaviour checked in the installed `next` 16.3.5 and `@sentry/nextjs` 10.58.0 source. Returned as
text (policy forbids report files); recorded by the orchestrator.

## Checks
- Gates: type-check clean; eslint and prettier clean on touched files; targeted Jest 6 suites, 84 pass.
- Build with dummy DSN (Turbopack): passes. DSN public key in shared chunk `1xk0o87o37d55.js`;
  browser init `enabled`, `tracesSampleRate:.1`, BrowserTracing the only integration, no
  `sendDefaultPii`, tunnel `/monitoring`. Replay in 0 files. No public `.map` files.
- Build without a DSN (CI shape): passes, no tunnel rewrite.
- Server: Node instrumentation compiled from `src/instrumentation.ts`, exports `register` and
  `onRequestError`; Edge chunk bundles only `sentry.edge.config.ts`; no tracked file references the
  deleted files. `captureRequestError`, `captureRouterTransitionStart`, `tunnelRoute` all exist.
- Middleware: afterFiles rewrites run after middleware (`resolve-routes.js:63-75`); CSP directives
  and matcher unchanged; one exact-match clause added. Plan tasks 1–9 present; interdicted files
  unchanged; no accepted ADR contradicted.

## Mutations (each restored, `git diff --exit-code` clean)
Replay re-added 2 red · `onRequestError` dropped 1 · server config on Edge 1 · `/monitoring` removed
from sessionless paths 1 · `sendDefaultPii: true` 1 · `tunnelRoute` removed 2 · prefix instead of
exact match 1 · Replay sample rate re-added 1.

## Findings (minor — follow-ups)
1. The tunnel forwards to any Sentry project: `tunnel.js:25-71` forwards any numeric `o`/`p` (and
   `r`) to `o<o>.ingest[.<r>].sentry.io/api/<p>/envelope/`; Next anchors the query checks
   (`prepare-destination.js:101`), so arbitrary hosts are unreachable. Next cycle: middleware 404s
   when `o`/`p` do not match the DSN.
2. The client's `release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` overrides the SDK-injected
   SHA; if Vercel does not expose it, the browser release is `undefined`. Pre-existing option, now
   shipping.

## Not verified
Live delivery on Vercel; a real server `onRequestError` event; `next build --webpack`; ad-blockers
on `/monitoring`. After deploy: throw an uncaught error on www.recopyfa.st → `POST /monitoring?o=…&p=…`
200 and the event in `base32-pg/recopyfast`; make a route handler fail and look for the server event.

Max severity: minor
Ship allowed: yes
