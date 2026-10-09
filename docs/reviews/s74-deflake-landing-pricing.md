# Review — s74-deflake-landing-pricing

Reviewer: fresh-context `reviewer` subagent, 2026-10-09. Diff: `git diff origin/main...feature/s74-deflake-landing-pricing`
(72f4cff → 3145c83; 4a60384 docs).

## Verdict summary

Diagnosis holds. CI run 37902163949 (job 113727016480): E2E-012 failed at 15,071 ms on `#pricing h3`, passed on retry
in 35,562 ms with the pricing cache warm; E2E-017 mocks its feed yet takes 30–56 s in every green run (42.5 s in
37941708681, 54.1 s in 37940423210); the placeholder Stripe key returns 401 fast — so the pricing feed is not the cause.
Playwright 1.58 Chromium headless renders WebGL with SwiftShader (`--enable-unsafe-swiftshader`,
chromium.js:280); `failIfMajorPerformanceCaveat: true` refuses it and accepts Metal; three 0.182 is WebGL2-only.
Probe: 40 contexts with and without `loseContext()` — releasing never evicts a live context. SSR-safe (`dynamic(…,
{ ssr: false })`, lazy initializer), no hydration warnings, same fixed `-z-10` layer, a canvas is no LCP candidate;
GPU path Canvas props/children identical to main. Contract 80 → 81 consistent everywhere.

Gates: jest 383 suites / 4,950; type-check (both) 0; lint 0 errors; `format:check` clean; `build:embed -- --check`
45828; `--list` 81; `next build` ok (`/` static); E2E-019 on the fixed build 3/3. 12 mutations red (caveat flag,
webgl1, no loseContext, rethrow, null context, gate open/closed, data-sky constant, gradient removed, contract
counts); E2E-019 red with the gate forced open (canvas count 1). M13 (frameloop always regardless of reduced
motion) survived — gap predates the diff.

## Findings

minor 1 — branch 2 commits behind main (stories.md append conflict). minor 2 — E2E-019 depends on a GPU-less runner
(deterministic, loud; better: force SwiftShader for that test). minor 3 — AC 2 (reduced motion draws on demand) not
pinned. minor 4 — comment at landing.spec.ts:361 implies the E2E-017 reload timeout happened in CI (it was local);
hardware-webgl.ts:8 "every CI runner".

`/api/pricing` follow-up confirmed real (Stripe SDK defaults 80 s timeout + 2 retries, three serial rounds, no shared
in-flight build, no maxDuration): low likelihood, medium impact → own story s94-pricing-resilience.

## Not verified

The fix in CI (first PR run must show E2E-019 green on Linux, E2E-017 down to seconds, strict 81/0/0/0; re-run 2–3×).
Firefox/Safari behaviour of the caveat flag; low-end GPU probe cost; visual check of the sky with and without
hardware acceleration.

## Fix pass `01f2b6b` (rebased onto fc5968b)

minor 2 — E2E-019 is self-contained: it launches its own Chromium with the configured args plus `--use-gl=angle
--use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (the only flags that make Chromium refuse
`failIfMajorPerformanceCaveat`; `test.use({ launchOptions })` inside a describe is a load error in Playwright 1.58 and
`--use-angle=swiftshader` still grants a caveat-free context — flag table in the plan). Before: red on a GPU config at
its precondition; after: green on default headless (5/5, 3/3), GPU (`--use-angle=metal`, 3/3) and headed (1/1); with
the sky gate forced open: red on both ("expected 0, received 1"). minor 3 — reduced motion pinned (`frameloop`
"demand" vs "always"; both mutations red). minor 4 — comments corrected. Jest 383 suites / 4,964; type-check (both) 0;
lint 0 errors; format:check clean; build:embed 45828 / 33062; Playwright `--list` 81. Reviewed by the orchestrator.

## Devin Review on PR #80 — fixed

🔴 **Direct SwiftShader rendering bypasses the sky gate** (valid): Chromium launched with `--use-angle=swiftshader`
grants even the caveat-free WebGL2 context, so `failIfMajorPerformanceCaveat` alone answered "hardware". The probe now also
reads the renderer name (`WEBGL_debug_renderer_info`, else `RENDERER`) and treats SwiftShader / llvmpipe / softpipe /
"Basic Render" / "software" as software, releasing the context either way. Test (red first): a fake browser that grants the
caveat-free context but reports a SwiftShader renderer → no shader sky. Sky suites 11/11. Reviewed by the orchestrator.

Max severity: minor
Ship allowed: yes
