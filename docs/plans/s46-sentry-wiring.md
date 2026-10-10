---
validated: yes
validated_by: 'operator request 2026-09-26 — "add the RecopyFast project to my Sentry"'
validated_at: 2026-09-26
---

# Plan — Story s46-sentry-wiring

Branch: `feature/s46-sentry-wiring`
Research: `docs/research/s46-sentry-wiring.md` — read it first; this plan does not repeat it.

## Target story

Production errors reach Sentry (`base32-pg/recopyfast`). The fixes:
- Move the browser init to `src/instrumentation-client.ts`, where Next 16 and Turbopack load
  it.
- Keep one runtime-aware server instrumentation, in `src/`, and export `onRequestError`.
- Tunnel browser envelopes same-origin through `tunnelRoute`.
- Let `isSessionlessPath` pass the tunnel through the middleware.

Unchanged: `enabled` stays production-only, the sample rates stay, PII stays off, Replay is
kept (it already existed), and there is no CSP widening.

## Tasks (ordered)

1. [x] Server instrumentation, test-first. New `src/__tests__/instrumentation.test.ts`
   (`@jest-environment node`). `@sentry/nextjs` is mocked, and the two root config modules are
   mocked to record that they were loaded.
   - Red:
     - under `NODE_ENV=production` with a DSN, `register()` loads only
       `sentry.server.config` on `NEXT_RUNTIME=nodejs`, only `sentry.edge.config` on `edge`,
       and nothing on an unknown runtime;
     - nothing loads without a DSN, or outside production;
     - `onRequestError` is `Sentry.captureRequestError`;
     - layout: no root `instrumentation.ts` and no root `instrumentation-client.ts`, so no
       root copy can shadow `src/` under Turbopack.
   - Green: rewrite `src/instrumentation.ts`, with a tombstone comment for the root/src
     shadowing. Delete root `instrumentation.ts`.
2. [x] Client init, test-first. New `src/__tests__/instrumentation-client.test.ts`, with
   `@sentry/nextjs` mocked.
   - Red:
     - the module calls `Sentry.init` once, with the env DSN;
     - `enabled` is true only when `NODE_ENV=production`;
     - `tracesSampleRate` is 0.1 in production;
     - Replay stays at 0.1/1.0 with `maskAllText`, `maskAllInputs` and `blockAllMedia`;
     - `sendDefaultPii` is not enabled;
     - `beforeSend` attaches only the user id, never the email;
     - `onRouterTransitionStart` is `Sentry.captureRouterTransitionStart`;
     - the Task 1 layout test gains "no `sentry.client.config.{ts,js}`", because webpack
       would inject it as well and initialise twice.
   - Green: create `src/instrumentation-client.ts` from `sentry.client.config.ts`, with the
     same options, and delete the old file.
3. [x] Tunnel in `next.config.ts`, test-first. New `src/__tests__/next-config-sentry.test.ts`
   (`@jest-environment node`, real `withSentryConfig`).
   - Red: with a DSN set, `rewrites()` contains Sentry's tunnel rules for `/monitoring(/?)`
     (query `o`/`p` → `https://o:orgid.ingest…sentry.io/api/:projectid/envelope/?hsts=0`), and
     `env._sentryRewritesTunnelPath` is `/monitoring`.
   - Guards:
     - the `/pricing` redirect survives the wrap;
     - without a DSN the config is unwrapped (no tunnel rule).
   - Green: `src/lib/monitoring/sentry-tunnel.ts` exports `SENTRY_TUNNEL_ROUTE = "/monitoring"`.
     `next.config.ts` passes it as `tunnelRoute`.
4. [x] Middleware lets the tunnel through, test-first. Extend
   `src/__tests__/middleware-matcher.test.ts` with `SENTRY_TUNNEL_ROUTE` as a sessionless
   path.
   - Red: no GoTrue round trip on `/monitoring`. Also: still matched, still `nosniff`, same
     header set as a page, and no bypass for `/monitoring/anything`.
   - Guard (declared, proven by mutation): a page's CSP `connect-src` includes `'self'`.
   - Green: `isSessionlessPath` includes the exact tunnel path, with a "why" comment. The
     middleware CSP comment at `:208-211` is refreshed for the tunnel.
5. [x] Gates and evidence.
   - `npm run precommit`, `format:check`, `type-check:build`.
   - `npm run build` with `NEXT_PUBLIC_SENTRY_DSN=https://s46dummypublickey@o0.ingest.sentry.io/0`
     and no `SENTRY_AUTH_TOKEN`.
   - Record the evidence:
     - the DSN key in `.next/static`;
     - the compiled instrumentation's source;
     - the tunnel rewrite in `.next/routes-manifest.json`;
     - the first-load JS delta.
   - Add the s46 entry to `docs/stories.md`, fill the Execution log, and make one story commit.

## Follow-up: the browser ships error reporting, not Session Replay

Operator decision, 2026-09-26. The Task 5 build showed the client SDK adding +121,922 B gzip to
every page's first load. The ruling: launch landing pages cannot carry that, and error reporting
is the goal. This supersedes two things:
- "Replay is kept" in the target story;
- the Replay and `docs/architecture.md` interdicts below.

6. [x] No Session Replay, test-first, in `src/__tests__/instrumentation-client.test.ts`.
   - Red: Replay is absent. No `replayIntegration` call, no `Replay` integration, and no replay
     sample rates.
   - Guard: the client sets no `tunnel` of its own.
   - Green: remove Replay from `src/instrumentation-client.ts`. Add a why-comment that names
     the lazy route (`Sentry.lazyLoadIntegration("replayIntegration")`) as a later decision.
7. [x] Browser tracing, decided by measurement.
   - Build each case for production, with the dummy DSN `https://public@o0.ingest.sentry.io/0`
     and no `SENTRY_AUTH_TOKEN`.
   - Measure the shared first-load JS gzip for three cases:
     - (a) main before s46;
     - (b) errors-only;
     - (c) errors + `browserTracingIntegration` at the current `tracesSampleRate`.
   - Keep browser tracing only if (c) − (b) ≤ 20 KB, and pin the choice in a test. Server
     tracing is unchanged.
8. [x] `docs/architecture.md:36` and `:371` describe the new file layout:
   - `src/instrumentation-client.ts`;
   - `src/instrumentation.ts`;
   - `sentry.server.config.ts` / `sentry.edge.config.ts`;
   - the `/monitoring` tunnel.
9. [x] Gates.
   - `npm run precommit`.
   - `npm run build`, confirming the dummy DSN is still in `.next/static`.
   - One commit, `perf: ship Sentry error reporting without Session Replay`.

## Run interdicts

- `sentry.server.config.ts` and `sentry.edge.config.ts` have empty diffs: sample rates,
  `enabled` and redaction are unchanged.
- The CSP directive list and `config.matcher` in `src/middleware.ts` are unchanged. Only
  `isSessionlessPath` and comments change.
- No Session Replay option added or changed. No `sendDefaultPii`. No new integration.
- `package.json`, `package-lock.json`, `AGENTS.md`, `docs/architecture.md` and
  `docs/decisions/` have empty diffs.
- No push, PR, merge, Vercel or Sentry setting change, or production request. Never
  `--no-verify`.

## The point everything turns on

Which instrumentation file the bundler actually compiles. It was settled from build output, not
from reading Next's code (research fact 2). Check it against:
- **The post-change build's source map** for `.next/server/instrumentation.js`. It must name
  `src/instrumentation.ts`. If a root copy ever returns, Turbopack loads the root copy instead,
  silently.
- **Webpack mode.** `dist/build/index.js:695-701` only scans `src/` for this layout, so `src/`
  is the only location both bundlers agree on.
- **The client.** The DSN key must appear in `.next/static` after the change and was absent
  before. That is the observable proof that `instrumentation-client.ts` is loaded.

## Files touched

- `src/instrumentation.ts` (rewritten), `src/instrumentation-client.ts` (new)
- `instrumentation.ts` (deleted), `sentry.client.config.ts` (deleted)
- `src/lib/monitoring/sentry-tunnel.ts` (new), `next.config.ts`, `src/middleware.ts`
- Follow-up: `src/instrumentation-client.ts`, its test, `docs/architecture.md`, and the s46
  entry in `docs/stories.md`
- Tests: `src/__tests__/instrumentation.test.ts`, `src/__tests__/instrumentation-client.test.ts`,
  `src/__tests__/next-config-sentry.test.ts` (new), `src/__tests__/middleware-matcher.test.ts`
- `docs/research/s46-sentry-wiring.md`, `docs/plans/s46-sentry-wiring.md`, `docs/stories.md`

## Test strategy

Unit tests at the boundaries the bundler and router consume:
- what `register()` loads per runtime;
- what `instrumentation-client` hands to `Sentry.init`, and what it exports;
- what the real `withSentryConfig` produces (rewrites and `env`);
- what the middleware does on the tunnel path (GoTrue, headers).

The file-layout test pins the shadowing trap. What unit tests cannot prove (the bundler picking
the file up) is proven by the production build's artefacts. Delivery to Sentry itself is proven
only after deploy.

## Definition of Done

- All tasks ticked. Red observed before each green; guards declared and mutation-proven.
- `lint`, `type-check`, `format:check`, full `jest`, `type-check:build`, and `build` (dummy
  DSN, no auth token) are green.
- One commit `fix: production errors reach Sentry`.
- Operator, after merge and deploy:
  - load https://www.recopyfa.st, throw an uncaught error, and see a `POST /monitoring?o=…&p=…`
    answer 200;
  - see the event in `base32-pg/recopyfast`;
  - optionally add `SENTRY_AUTH_TOKEN` for source maps.

## Execution log

2026-09-26, worktree `.omx/worktrees/s46-sentry-wiring`, base `origin/main` `ef0fae6`.
- Every Jest run and build used the CI placeholder environment.
- Builds used `NEXT_PUBLIC_SENTRY_DSN=https://s46dummypublickey@o0.ingest.sentry.io/0`, with
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` unset.
- Nothing touched production, Vercel or Sentry settings.

**Dependencies.** The worktree's symlinked `node_modules` held `next` 16.2.12, but the
lockfile pins 16.3.5, which is what Vercel installs. The worktree was given its own `npm ci`
(`next` 16.3.5, `@sentry/nextjs` 10.58.0) so the evidence below matches production.

Incident: the symlink removal hit an interactive `rm -i` alias and was declined by EOF. `npm ci`
then ran through the symlink and emptied the **main checkout's** `node_modules`. For about six
minutes, the worktrees that symlink to it (docs-launch-live-proof, docs-launch-report,
fix-api-keys-site-id, s40–s45) had no dependencies. It was restored with `npm ci` in the main
checkout from its unchanged lockfile: 1,108 packages. That tree now holds lockfile versions
(`next` 16.3.5) instead of the stale 16.2.12. Its `git status` is unchanged (the pre-existing
`M AGENTS.md` only).

**Baseline build (before any change).** "▲ Next.js 16.3.5 (Turbopack)", passed.
- The DSN key was in **0** files of `.next/static`, and `maskAllText` in 0.
- `routes-manifest.json` had no `/monitoring` rewrite.
- `.next/server/instrumentation.js` compiled from the **root** `instrumentation.ts`, and its
  Edge chunk bundled `sentry.edge.config.ts` (research fact 2).
- Shared first-load JS (`rootMainFiles`) was 131,764 B gzip.

**Tasks**
- **Task 1**: red, 4 of 12 failed:
  - Edge loaded the Node config;
  - an unknown runtime loaded the Node config;
  - `onRequestError` was undefined;
  - the root file existed.

  The 8 that passed are guards on behaviour that was already correct: Node loads the server
  config, nothing without a DSN or outside production, `src/` exists, and the other root
  variants are absent. Green: 12/12.
- **Task 2**: red, 10 of 23 failed: 8 on "Cannot find module", plus the two layout cases.
  Green: 23/23.
- **Task 3**: red, 2 of 4 failed (no tunnel rewrite, no `_sentryRewritesTunnelPath`). The two
  guards passed before the change: the `/pricing` redirect survives the wrap, and the config is
  unwrapped without a DSN. Green: 4/4, plus `next-config-redirects` 1/1.
- **Task 4**: red, 1 of 38 failed: "spends no GoTrue round trip on /monitoring". The other new
  cases pass by construction and are declared guards: matched, `nosniff`, the header set, no
  sibling bypass, and `'self'`. Green: 38/38, plus `middleware.test.ts` 16/16.

**Mutation checks.** Each was applied alone, then restored with `/bin/cp -f` and its sha256
checked by script. All were killed:
- M1, `'self'` removed from connect-src → 1 failed.
- M2, prefix instead of exact tunnel match → 1 failed.
- M3, always wrap → 1 failed.
- M4, register gate removed → 2 failed.
- M5, `else → Node` → 1 failed.
- M6, email in `event.user` → 1 failed.
- M7, `maskAllText: false` → 1 failed.

**Gates**
- `npm run precommit`:
  - lint: 0 errors, 38 warnings, all inherited; touched files clean.
  - type-check: clean after one fix. My test spread `beforeFiles`, which Next types as
    optional; it now uses `?? []`.
  - Jest: 275 suites passed / 2 skipped, **3,570 tests passed** / 39 skipped.
- `format:check`: clean. `type-check:build`: clean.
- `npm run build` (dummy DSN, no auth token): passed.
  - Sentry warned "No auth token provided. Will not create release / upload source maps".
  - There was no `onRouterTransitionStart` "ACTION REQUIRED" warning.
  - The `fetch failed` lines are the placeholder environment's catalogue reads, as in s45.
  - The build changed no tracked file.

**Build evidence (after)**
- **Client:** `s46dummypublickey` is in 1 file,
  `.next/static/chunks/0wqep2mvx6pus.js`, which is one of the `rootMainFiles` (loaded on every
  page). `maskAllText` is in 1 file, `_sentryRewritesTunnelPath` in 1, `/monitoring` in 2.
- **Server:** `.next/server/instrumentation.js` →
  `chunks/[root-of-the-server]__0dmsq_0._.js`.
  - Its map's only source is `../../../src/instrumentation.ts`.
  - It exports `onRequestError` and `register`.
  - The Edge instrumentation chunk's sources are `src/instrumentation.ts` and
    `sentry.edge.config.ts`.
- **Tunnel:** `routes-manifest.json` has two rewrites for `/monitoring(/?)`:
  - `has [o,p,r]` → `https://o:orgid.ingest.:region.sentry.io/api/:projectid/envelope/?hsts=0`
  - `has [o,p]` → `https://o:orgid.ingest.sentry.io/api/:projectid/envelope/?hsts=0`
- **Cost:** shared first-load JS went from 131,764 to **253,686 B gzip (+121,922 B)** on every
  page. This is the pre-existing client config shipping for the first time: SDK, tracing, and
  Replay (kept because it already existed). Total `.next/static/chunks` gzip went from 790,658
  to 898,337 B. The embed is unaffected: `public/embed/` is unchanged, 0 bytes.

**Declared deviations and findings against the brief**
1. **Finding 2 was inverted.** Under Turbopack the root `instrumentation.ts` was the live
   one, and `src/instrumentation.ts` was dead. Webpack is the reverse. The consolidation still
   lands in `src/`, as the brief asked, but for this reason: it is the one location both
   bundlers load when it holds the only copy. The build evidence above confirms it.
2. **Finding 3 was partly refuted.** `connect-src` already allowed the DSN origin
   (`src/middleware.ts:239` before this change), so the CSP was not the blocker. The tunnel
   was added as asked, and no directive changed. The `addOrigin(DSN)` line was kept as the
   fallback for a non-SaaS DSN, which the SDK does not tunnel. Only comments changed there.
3. **The tunnel stays inside `config.matcher`.** Sentry's docs say to exclude it; this repo's
   rule keeps sessionless paths matched for their security headers and short-circuits them in
   `isSessionlessPath`.
4. **context7 was used through its HTTP API.** This lane had no context7 MCP tools. The
   libraries and topics queried are listed in the research.
5. **The plan was edited before execution.** The `sentry.client.config` layout assertion moved
   from Task 1 to Task 2, because Task 2's green deletes that file.
6. **An existing test file was extended, not changed.** In `middleware-matcher.test.ts`,
   `SESSIONLESS_PATHS` gains `TUNNEL_PATHS`, and a new `describe` was added. No existing
   assertion changed.
7. **Not fixed, out of scope, noted for the operator:**
   - `docs/architecture.md:36`, `:371` still describe "3 config files + `instrumentation.ts`".
   - `hideSourceMaps` is no longer a v10 option.
   - `disableLogger` is deprecated and ignored by Turbopack.
   - `withSentryConfig` sends build telemetry to Sentry.
   - Next warns that `middleware` is deprecated in favour of `proxy`.
   - Replay's `blob:` compression worker is blocked by the CSP and falls back to uncompressed
     segments.

**Delivery**: one story commit on `feature/s46-sentry-wiring`. Not pushed, no PR. Operator,
after merge and deploy:
1. On https://www.recopyfa.st, throw an uncaught error. Expect `POST /monitoring?o=…&p=…`
   → 200, and the event in `base32-pg/recopyfast`.
2. Also trigger a failing route handler. Expect a server event (`onRequestError`).
3. Optional: set `SENTRY_AUTH_TOKEN` in Vercel for releases and source maps.

### Follow-up, 2026-09-26: the browser ships error reporting, not Session Replay

Same worktree, on top of `72376c8`. Same environment as above, but the builds used
`NEXT_PUBLIC_SENTRY_DSN=https://public@o0.ingest.sentry.io/0`. Nothing touched production,
Vercel or Sentry settings.

**Measurement.** The metric is the shared first-load JS: `build-manifest.json`
`rootMainFiles`, each gzipped with Node's `gzipSync` at the default level, then summed. This
reproduces the Task 5 figure, 253,686 B, exactly.

| Build | Shared first-load JS, gzip |
|---|---|
| (a) `main` before s46 | 131,764 B |
| s46 as first committed (with Replay) | 253,686 B |
| (b) errors-only | 214,663 B |
| (c) errors + `browserTracingIntegration`, `tracesSampleRate` 0.1 | 214,721 B |
| (d) informative: (b) + `__SENTRY_TRACING__: false` define | 197,987 B |
| Final commit, which is (c) plus comments | 214,719 B |

- **Tracing decision: kept.** (c) − (b) = 58 B, far under 20 KB. @sentry/nextjs's client `init`
  bundles `browserTracingIntegration` as a default integration either way (research, follow-up
  section).
- Even the tracing code itself, which only a build-time define can remove, is 16,734 B,
  (c) − (d). That is also under the bar.
- Replay was 38,965 B, not the ~100 KB assumed. Most of the +121,922 B is the SDK's error
  reporting core: +82,899 B over (a).
- (b) and (d) were temporary edits, used only to measure:
  - (b) is `instrumentation-client.ts` without `tracesSampleRate`, with BrowserTracing filtered
    out of the defaults, and without `onRouterTransitionStart`;
  - (d) also adds a `compiler.define` to `next.config.ts`.

  Both files were restored from copies and checked: `next.config.ts` by sha256, the client file
  with `cmp`. `next.config.ts` has an empty diff.

**Tasks**
- **Task 6**: red, 1 of 9 failed: "ships no Session Replay". Its companion, "sets no tunnel of
  its own", passed by construction and is a declared guard. Green: 9/9, plus
  `instrumentation.test.ts`, 24/24 in total.
- **Task 7**: "keeps browser tracing: the one integration it registers" is a declared guard.
  Keeping tracing means there is no red to observe. The existing 10% sampling test still pins
  the rate. Result: 10/10.
- **Task 8**: `docs/architecture.md:36` and `:371` rewritten.

**Mutation checks.** Each was applied alone, then restored and checked by sha256. All were
killed:
- M8, tracing dropped → 1 failed.
- M9, own `tunnel` → 1 failed.
- M10, `replaysOnErrorSampleRate` back → 1 failed.
- M11, `replayIntegration` back → 2 failed.
- M12, `enabled: true` → 1 failed.
- M13, DSN dropped → 1 failed.

**Gates**
- `npm run precommit`:
  - lint: 0 errors, 38 inherited warnings;
  - type-check: clean;
  - Jest: 275 suites passed / 2 skipped, **3,572 tests passed** / 39 skipped.
- `format:check`: clean. `type-check:build`: clean.
- `npm run build`: passed.
  - `public@o0.ingest.sentry.io` is in 1 file, `.next/static/chunks/29vvcbh1hop_y.js`, which
    is one of the `rootMainFiles`.
  - `maskAllText` and `rrweb` are in 0 files. `/monitoring` is in 2.
  - There is no "ACTION REQUIRED" warning.

**Declared deviations**
1. The brief said to note that Replay was "+~100 KB". The measurement says 38,965 B, so the
   why-comments carry the measured figure.
2. The why-comment adds a trap to the lazy route. `lazyLoadIntegration` loads from
   `browser.sentry-cdn.com`, which the CSP's `script-src 'self'` blocks.
3. `docs/stories.md:1726` said "Replay masking unchanged", which is no longer true. That bullet
   was amended. This was not in the brief.
4. The story now has two commits, because the operator asked for this follow-up as its own
   commit.
