# Research — Story s46-sentry-wiring

Date: 2026-09-26. Scope: repository at `origin/main` `ef0fae6`, installed exactly from
`package-lock.json` (`next` **16.3.5**, `@sentry/nextjs` **10.58.0**). Also used: the operator
orchestrator's live evidence from the same day. A Playwright run on https://www.recopyfa.st
threw an uncaught error and sent **zero** requests to Sentry, and the new DSN's public key is
absent from the homepage JS chunks. No production access was used by this lane. Vercel env
(`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG=base32-pg`, `SENTRY_PROJECT=recopyfast`) was set by the
orchestrator. It was not read or changed here.

Sources relied on:
- context7 `/getsentry/sentry-docs`, queried 2026-09-26 through the context7 HTTP API (this
  lane had no MCP tool): "Register Runtime Configurations in instrumentation.ts" and "Export
  onRequestError" (guides/nextjs/index.mdx), "Configure tracesSampleRate in
  instrumentation-client" (`captureRouterTransitionStart` "available from SDK version 9.12.0
  onwards"), "do not use the deprecated sentry.client.config.ts" (manual-setup/pages-router.mdx),
  "Configure tunnelRoute in next.config.ts" and "Exclude tunnel route in proxy.ts matcher"
  (manual-setup/index.mdx), and the Turbopack notes (sourcemaps overview, tree-shaking).
- context7 `/vercel/next.js`: instrumentation-client and instrumentation live "in the root or
  inside `src`".
- Where the docs are silent or version-sensitive, the installed sources were used, and they win:
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation{,-client}.md`
  - `node_modules/next/dist/build/index.js`, `dist/build/create-compiler-aliases.js`
  - `node_modules/@sentry/nextjs/build/cjs/**`

## The five structuring facts

1. **The browser SDK is never initialised in production.** Client init lives only in
   `sentry.client.config.ts:10-107`. `next build` on Next 16 bundles with **Turbopack** by
   default (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:100-101`;
   baseline build log: "▲ Next.js 16.3.5 (Turbopack)"). Only Sentry's **webpack** entry
   injection loads `sentry.client.config.*` (`@sentry/nextjs/build/cjs/config/webpack.js:209-213`,
   `:273-287`). The SDK itself warns: "When using Turbopack `sentry.client.config.ts` will no
   longer work". Under Turbopack, Sentry's build-time values (tunnel path, route manifest) are
   injected only into files matching `**/instrumentation-client.*`
   (`config/turbopack/generateValueInjectionRules.js:36`).
   - **Reproduced locally**: a baseline build with `NEXT_PUBLIC_SENTRY_DSN=https://s46dummypublickey@o0.ingest.sentry.io/0`
     puts the key in **0** files under `.next/static` and `maskAllText` in 0 files. This matches
     the live finding. `error.tsx`/`global-error.tsx` call `Sentry.captureException` on a
     client that was never created.
2. **Finding 2 is inverted under Turbopack.** The live server instrumentation is the **root**
   `instrumentation.ts:7-16` (Edge-aware, production and DSN gated). The dead one is
   `src/instrumentation.ts:6-19`: server config for every runtime, `console.log` at `:15`/`:17`.
   - Evidence from the baseline build:
     - `.next/server/instrumentation.js` → `chunks/_16lmzdm._.js`, whose source map lists
       exactly one source, `../../../instrumentation.ts`. That is the same base under which
       `sentry.server.config.ts` and `src/lib/monitoring/logger.ts` appear in sibling maps, so
       it is the root file.
     - The compiled `register` is a bare `await import(server config)`, with no
       "Production monitoring initialized" string.
     - The edge instrumentation chunk (`edge/chunks/_131f9gs._.js.map`) bundles
       `sentry.edge.config.ts`, which only the root file imports.
   - The Turbopack binary's lookup strings put the root before `src/`: `middleware.` /
     `src/middleware.`, `proxy.` / `src/proxy.`, and `./src/instrumentation-client.` before
     `./instrumentation-client.`. So **root wins when both exist**.
   - Webpack is different: it only scans `join(appDir, '..')`, which is `src/` here
     (`next/dist/build/index.js:695-701`). So `next build --webpack` would run the *other* file.
     Which file runs depends on the bundler: that is the trap.
   - With a single file in `src/`, both bundlers find it. Consolidate there.
3. **Server-side capture of request errors is missing on either file.** Neither exports
   `onRequestError`, so errors that Next catches in route handlers, server components and
   middleware are never handed to Sentry. The docs prescribe
   `export const onRequestError = Sentry.captureRequestError` in the instrumentation file
   (Next: `instrumentation.md:36-46`; SDK: `common/captureRequestError.js:6`).
4. **CSP was not the blocker, and it needs no widening.**
   - `src/middleware.ts:239` already calls `addOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN)`,
     which puts `https://<dsn host>` into `connect-src` (`:213-236`, `:252`). With the SDK's
     `tunnelRoute`, the browser posts to a **same-origin** path, which `connect-src 'self'`
     (`:212`) already covers.
   - `tunnelRoute` is implemented as Next rewrites (`withSentryConfig/tunnel.js:19-80`):
     source `${tunnelPath}(/?)` with `has` queries `o`, `p` (and `r` for region) → destination
     `https://o:orgid.ingest[.:region].sentry.io/api/:projectid/envelope/?hsts=0`.
   - `next.config.ts:115-119` returns an array, so the SDK prepends to it (`tunnel.js:77`).
     These are after-files rewrites, which run **after** middleware.
   - The browser learns the path from `process.env._sentryRewritesTunnelPath`, set through
     `nextConfig.env` (`withSentryConfig/buildTime.js:10`, `:25-27`, `:41-45`), and applies
     it only to a SaaS DSN host `^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$`
     (`client/tunnelRoute.js:14`).
5. **The middleware runs on the tunnel path and would spend a GoTrue round trip per event.**
   - `/monitoring` is inside `config.matcher` (`src/middleware.ts:287`), is not protected
     (`:128`) and not an auth route, so today it would be passed through. It is **not
     blocked**, but only after `supabase.auth.getUser()` (`:120-122`), and possibly with a
     rotated session cookie written onto Sentry's response.
   - Sentry's docs say to exclude the tunnel from the matcher. This codebase's rule for
     sessionless paths is the opposite: keep them matched so they keep the security headers,
     and short-circuit inside with `isSessionlessPath` (`:50-80`, `:88-90`; pinned by
     `src/__tests__/middleware-matcher.test.ts`). The tunnel joins that list as an exact path,
     so the matcher needs no change.

## Target story

Production errors reach Sentry project `base32-pg/recopyfast`:
- uncaught browser errors and error-boundary captures;
- server and edge errors, including request errors Next catches;
- all without widening the CSP, without auth-gating the ingest path, with `enabled`
  production-only, sample rates unchanged and PII off.

Acceptance:
- A production build with a DSN bundles the client init: the DSN public key is present in
  `.next/static`, and `onRouterTransitionStart` is exported.
- One server instrumentation file, in the location both bundlers load. `register()` imports
  `sentry.server.config` on `nodejs` and `sentry.edge.config` on `edge`, nothing otherwise, and
  only in production with a DSN. `onRequestError = Sentry.captureRequestError`.
- `withSentryConfig` sets a fixed `tunnelRoute` when the DSN is set. The resulting config
  rewrites that path to Sentry ingest and exposes it to the client. Without a DSN the config is
  unwrapped (CI builds without it).
- The middleware lets the tunnel path through: no GoTrue call, no redirect, security headers
  still set, `connect-src 'self'` covers it.
- `npm run build` passes with a dummy DSN and no `SENTRY_AUTH_TOKEN`.

## Current state of the code

- `sentry.client.config.ts` is the client init. It has:
  - production-only `enabled` (`:17`) and `tracesSampleRate` 0.1 in production (`:20`);
  - Replay at 0.1/1.0 (`:23-24`) with `maskAllText`/`blockAllMedia`/`maskAllInputs` (`:31-38`);
  - `browserTracingIntegration` (`:39`) and `ignoreErrors`;
  - a `beforeSend` that drops extension and third-party stacks and attaches **only** the user
    id from `localStorage.user` (`:84-96`).

  It is dead under Turbopack.
- `sentry.server.config.ts` / `sentry.edge.config.ts` are the server and edge inits.
  Production-only `enabled`, sample rates 0.1 and 0.05, redaction in `beforeSend`. They are
  loaded by the root instrumentation.
- `instrumentation.ts` (root, live under Turbopack) and `src/instrumentation.ts` (dead under
  Turbopack, live under webpack). See fact 2.
- `next.config.ts:144-171`: `withSentryConfig(nextConfig, { org, project, silent,
  widenClientFileUpload, disableLogger, hideSourceMaps })`, applied only when
  `NEXT_PUBLIC_SENTRY_DSN` is set.
  - `hideSourceMaps` is no longer a v10 option (absent from `build/types/config/types.d.ts`).
  - `disableLogger` is deprecated and ignored by Turbopack; the build prints the warning.

  Neither blocks events. Both are out of scope.
- `src/app/error.tsx:31-33` and `src/app/global-error.tsx:28-30` already call
  `Sentry.captureException`. They start working once the client is initialised.
- `src/lib/monitoring/logger.ts:166-181` forwards server errors through `Sentry.withScope`.

## Anchor points

- New `src/instrumentation-client.ts`: the moved client init, plus
  `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`.
- `src/instrumentation.ts`: rewritten to be runtime-aware, plus `onRequestError`.
  `instrumentation.ts` (root) and `sentry.client.config.ts` are deleted.
- `next.config.ts` `sentryWebpackPluginOptions`: `tunnelRoute`.
- `src/middleware.ts` `isSessionlessPath`: the tunnel path, plus the CSP comment at `:208-211`.
- New `src/lib/monitoring/sentry-tunnel.ts`: the one constant both `next.config.ts` and the
  middleware read. `next.config.ts` can `require` a local `.ts` module: Next registers an SWC
  require hook for `.ts`/`.cts`/`.mts` while loading the config
  (`next/dist/build/next-config-ts/transpile-config.js:115-119`, `require-hook.js:36-39`). It
  must be a relative import, because `@/` is not resolved there.

## Verified APIs / functions

- `Sentry.captureRequestError(error, request, errorContext)`: `@sentry/nextjs`
  `build/cjs/common/captureRequestError.js:6`, typed at `build/types/index.types.d.ts:94`.
- `Sentry.captureRouterTransitionStart(href, navigationType)`:
  `build/types/client/routing/appRouterRoutingInstrumentation.d.ts:10`, re-exported by
  `index.types.d.ts:7`.
- `withSentryConfig(nextConfig, { tunnelRoute?: string | boolean })`: `types.d.ts:521-530`.
  A string is used verbatim; `true` generates a random path per build (`tunnel.js:5-18`).
  **`@sentry/nextjs/config` (the import path in today's docs) is not an export of 10.58**
  (package `exports`: `.`, `./async-storage-shim`, `./import`, `./loader`), so the import
  stays `@sentry/nextjs`.
- Next `instrumentation-client.ts`: "in the root of your application or inside a `src`
  folder" (`instrumentation-client.md:8`). Webpack resolves `src/instrumentation-client` first
  (`create-compiler-aliases.js:179-183`).
- Next `onRequestError` in `instrumentation.ts` (`instrumentation.md:36-46`).

## Traps & constraints

- **Double init under webpack.** With both `sentry.client.config.ts` and
  `instrumentation-client.ts` present, webpack injects both (`webpack.js:278-284`). The old
  file must be deleted, not left behind.
- **Root vs `src` instrumentation** (fact 2). Leaving any root `instrumentation.ts` would
  shadow `src/instrumentation.ts` under Turbopack again. A layout test pins that no root copy
  exists.
- **The Turbopack value-injection matcher** is `**/instrumentation-client.*`. The file name is
  load-bearing.
- **Replay's compression worker** is a `blob:` worker. The CSP has no `worker-src`, so it
  falls back to `script-src 'self' 'unsafe-inline'`, which blocks `blob:`. Replay then "falls
  back to simple buffer" (`@sentry/replay/build/npm/cjs/index.js:5594`), so replay segments are
  uncompressed and a CSP violation is logged. No CSP widening was made (operator constraint).
  Replay stays because it already existed in the config. It now ships in every page's first
  load (see the plan's Execution log for measured size).
- **Tunnel path and ad blockers.**
  - `/monitoring` is the orchestrator's choice and a fixed path. Some filter lists know it. A
    random route (`tunnelRoute: true`) would change per build and could not be named in
    `isSessionlessPath` without reading an injected env value.
  - The middleware only needs the exact path: Next's default `trailingSlash: false` redirects
    `/monitoring/` before middleware.
- **The middleware body.** A POST envelope passes through `NextResponse.next({ request })`,
  well under Next's middleware body cap.
- **Build telemetry and uploads.** `withSentryConfig` sends build telemetry to Sentry
  ("Sending telemetry data…"). Without `SENTRY_AUTH_TOKEN` it skips release creation and
  source-map upload, with warnings. The build still passes.
- `jest.config.js` default env is jsdom with `customExportConditions: [""]`. Suites that load
  the real `withSentryConfig` should use `@jest-environment node`. No existing suite mocks or
  loads `@sentry/nextjs` directly.
- `docs/architecture.md:36`, `:371` say "3 config files + `instrumentation.ts`". This becomes
  2 config files, `src/instrumentation.ts` and `src/instrumentation-client.ts`. That is
  architecture drift for the operator to record. This lane does not touch architecture.

## Open questions

- Whether the operator wants Replay in every page's first load. It is kept here because it
  already existed; lazy-loading it is the documented alternative (context7 "Lazy-Load Replay
  Integration").
- Only a live deploy can prove events arrive, through the tunnel and in the Sentry project.
  This lane cannot deploy.

## Real complexity

2. Five small files and a rewrite rule. The risk is in *which file the bundler loads*, which is
settled by build evidence rather than by reading code.
