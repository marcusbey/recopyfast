# Research — s74-deflake-landing-pricing

Verified on `origin/main` `72f4cff`, 2026-10-09. Question: why can the `#pricing` Starter card take
more than 10 s to appear on the landing page in CI, and does the same cause reach production?

## What CI showed

Run 37902163949 (E2E job 113727016480), strict summary "79 passed, 0 failed, 0 skipped, 1 flaky".
E2E-012 failed after 15.07 s: `goto(load)` plus the 500 ms pause plus the full 10 s wait on
`#pricing h3 "Starter"`, with "element(s) not found" — the cards were not in the DOM yet. The retry
passed in 35.5 s. Landing timings across four `main` runs (ms):

| Test | 37867214021 | 37892339585 | 37896208802 | 37902163949 (red) |
|---|---|---|---|---|
| E2E-012 pricing (needs `/api/pricing`) | 3,030 | 1,961 | 1,797 | 15,071 ✘ / 35,562 |
| E2E-013 yearly toggle | 9,769 | 6,064 | 4,563 | 14,124 |
| E2E-014 monthly toggle | 11,580 | 6,229 | 6,354 | 55,390 |
| E2E-015 badge | 1,979 | 1,055 | 1,081 | 1,719 |
| E2E-016 Starter CTA | 9,581 | 1,409 | 1,184 | 8,585 |
| E2E-017 trust row (mocks `/api/offers/founding`, needs no plan card) | 56,250 | 31,124 | 29,810 | 56,116 |
| E2E-018 no fabricated claims | 706 | 443 | 484 | 10,105 |
| hero-demo-mobile "two swipes" (never reads pricing) | 16,911 | 6,012 | 6,146 | 16,437 |

The variance is not pricing-specific. E2E-017 and the hero swipe test never wait on a plan card and
swing 2–3× with the slow runs. E2E-018 took 10 s in the red run right after E2E-015 had rendered
the badge in 1.7 s, so `/api/pricing` was already served from its five-minute cache
(`src/app/api/pricing/route.ts:27,285-287`). Something on the page itself is slow.

## Reproduction

No Docker here (6.6 GB free), so the local stack is a throwaway PostgreSQL 14 with
`scripts/db/bootstrap-supabase-fixtures.sql` and every migration, Homebrew PostgREST 14, and a
20-line proxy serving `/rest/v1/*` on `127.0.0.1:54321`. `next build` and `next start` run with the
E2E job's env from `.github/workflows/ci.yml:181-203` (placeholder Stripe key and price ids). Same
Playwright 1.58 Chromium as CI.

Playwright launches Chromium with `--enable-unsafe-swiftshader`
(`node_modules/playwright-core/lib/server/chromium/chromium.js:280`). On a runner with no GPU, and
in headless mode on this Mac too, WebGL is drawn by SwiftShader on the CPU: the page reports
`UNMASKED_RENDERER_WEBGL` = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader
driver)".

### Main thread with the sky as shipped (production build, 1280×720)

| Path | Frames in 3 s | Frame p50 / p95 | Main-thread long tasks in the window |
|---|---|---|---|
| Hero visible (volumetric + layered), SwiftShader | 8–34 | 8–292 ms / 1,050–2,125 ms | 1.2–3.4 s |
| Pricing in view (layered only), SwiftShader | 2–3 | 1,418–2,071 ms | 2.7–4.8 s |
| Same, WebGL disabled (`--disable-3d-apis`) | 360 | 8.3 ms | 0 ms |
| Same, real GPU (`--use-angle=metal`, M1 Max) | 347–362 | 8.3 / 10.3 ms | 0–256 ms |

That is a 10-core M1 Max; the runner has 4 vCPUs shared with `next start`, the WebSocket server
and the Supabase containers. Every step the Starter card waits on queues behind those frames:
hydration of the client page (`src/app/page.tsx:1`), the `useEffect` that fetches `/api/pricing`
(`src/components/sections/Pricing.tsx:93-111`), the state update and the cards' render (`:231`),
and every Playwright locator, `evaluate` and actionability check.

### The spec as shipped

`npx playwright test e2e/landing.spec.ts --retries=0 --repeat-each=3`, production build: 26
passed, 1 failed. E2E-017 failed at 1.3 min because `page.reload({ waitUntil: "load" })` never
reached `load` in 45 s (`e2e/landing.spec.ts:265`). E2E-017 otherwise took 22.9 s and 25.2 s;
E2E-013 swung from 4.2 s to 12.7 s.

### Ruled out

- **`/api/pricing` and Stripe.** On a cold cache the route reads the catalogue, then calls
  `stripe.prices.retrieve` about nine times in three serial waves (`route.ts:208-211`), which
  with the CI placeholder key all fail with 401 and fall back to the database price. Measured:
  0.33 s cold, 3–6 ms warm. The SDK defaults (80 s timeout, 2 retries;
  `node_modules/stripe/esm/stripe.core.js:14,69`) would matter during a Stripe incident, not here.
  See follow-ups.
- **Cold compile.** CI serves `next start` on a production build; `/` is prerendered static (`○`
  in the build output). Nothing compiles on first hit.
- **Server-side render of pricing.** There is none: the cards are client-rendered after the fetch.

## Production

`curl https://www.recopyfa.st/` ×5: 200, 0.24–0.88 s, `x-vercel-cache: HIT`,
`x-nextjs-prerender: 1`. The HTML is a CDN static. A visitor with a GPU draws the sky at full
frame rate (table above), so this cause does not slow their pricing. A visitor whose browser can
only draw WebGL in software — GPU blocklisted, hardware acceleration switched off, a VM or remote
desktop — gets what CI gets: a page that draws a frame every one to two seconds and answers input
as slowly.

## Platform facts the fix relies on

- `getContext(…, { failIfMajorPerformanceCaveat: true })` is the WebGL spec's own signal: context
  creation fails when the implementation would perform dramatically worse than a native GPU
  application. Verified in Playwright's Chromium: SwiftShader → `webgl2` strict = no context,
  loose = context; `--use-angle=metal` → both a context; `--disable-3d-apis` → neither.
- three 0.182 is WebGL2-only (`node_modules/three/src/renderers/WebGLRenderer.js:63,104,389`). The
  probe must ask for `webgl2`: a `webgl` probe would approve a browser three cannot draw on.
- A canvas holds one context type, and browsers cap live WebGL contexts (Chromium: 16). The probe
  uses its own canvas and releases the context with `WEBGL_lose_context`, present under
  SwiftShader and Metal.
- `SkyBackground` is client-only (`dynamic(…, { ssr: false })`, `page.tsx:22-29`), so deciding in
  a lazy `useState` initializer cannot cause a hydration mismatch and never mounts the canvas for
  even one frame.
- `src/app/page.tsx` is the only consumer of `SkyBackground`. No E2E test asserts a canvas. No
  unit test covers the sky today.

## Options

| Option | Verdict |
|---|---|
| Raise E2E-012's 10 s timeout | Rejected by the brief, and it treats one symptom: E2E-017 fails on `page.reload` for the same reason. |
| Harness: warm the server before tests | Nothing to warm: production build, static `/`, pricing feed answers in 0.33 s cold. |
| Harness: `reducedMotion: "reduce"` in `playwright.config.ts` | Hides the product defect. The demand loop still shades the sky in software on every scroll step, and CI would stop exercising the page visitors get. |
| Harness: launch Chromium with `--disable-3d-apis` | CI would test a browser configuration no visitor runs and leave software-WebGL visitors on a saturated page. |
| Product: match the renderer string (SwiftShader, llvmpipe, …) | A vendor list that goes stale. The spec flag is the browser's own answer. |
| **Product: draw the shader sky only when WebGL has no major performance caveat; otherwise the static gradient the page already uses** | **Chosen.** Fixes software-WebGL visitors and CI with one rule. A GPU visitor is unchanged. |

## Traps

- jsdom has no WebGL: `HTMLCanvasElement.prototype.getContext` logs "Not implemented" and
  returns `null`. Unit tests must mock it, or every test passes on the no-WebGL branch.
- `@react-three/fiber` and three are ESM and need a GL context; the component test mocks the
  `Canvas`, `SkyLayered`, `SkyVolumetric` and `useLenis` (lenis is ESM too).
- Adding an E2E test moves the strict count in three files: `playwright.config.ts`,
  `.github/workflows/ci.yml` (placeholder JSON, step name, three `report.*` checks, the error
  string, the job comment) and `src/__tests__/e2e/playwright-ci-contract.test.ts`.
- `jest.setup.js:177-182` mocks `IntersectionObserver` with a no-op `observe`, so the component
  test sees the hero as visible and never observes it leave.

## Follow-ups (not in this story)

- `/api/pricing` reads Stripe with the SDK defaults (80 s timeout, 2 retries) in three serial
  waves, and does not coalesce concurrent cold builds the way `getPlanCatalogue` does
  (`src/lib/stripe/plans.ts:510-527`). During a Stripe slowdown a cold instance could hold the
  pricing skeleton for minutes. The CDN `s-maxage=300` (`route.ts:270-271`) limits how often a
  visitor pays it. Worth its own story: a short per-request timeout, no retries for the display
  overlay, one in-flight build.
- CI's E2E job still reaches `api.stripe.com` with a placeholder key on every cold pricing build.
  Harmless (0.33 s, always 401), but it is the one non-local dependency of the landing tests.
