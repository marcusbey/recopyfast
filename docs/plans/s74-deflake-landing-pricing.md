---
validated: yes
---
# Plan — Story s74-deflake-landing-pricing

> CTO decision under the owner's 2026-10-09 directive.

Research: `docs/research/s74-deflake-landing-pricing.md`. Design (state table, no new screen):
`docs/designs/s74-deflake-landing-pricing.md`. No API, data, embed, migration or `server/` change,
and no new dependency.

**CTO decision:** fix the product, not the harness. The sky draws its shader only when the browser
can create a WebGL2 context with `failIfMajorPerformanceCaveat: true`; otherwise it shows the
static gradient the page already uses as its loading and no-WebGL fallback. Reason: CI's Chromium
is one instance of a real visitor class, browsers that draw WebGL in software, and the flake is
that class's experience measured by a test. Harness-only options (reduced motion, disabling WebGL
at launch, longer timeouts) would leave those visitors on a page that draws a frame every one to two
seconds, and CI would stop testing the page they get. The spec's flag is preferred over a
renderer-name list because the browser maintains it. Options and their rejections are in the
research.

**CTO decision:** one new E2E test rather than editing an existing landing test. AGENTS.md § Tests
forbids changing a test to fit new behaviour; none of E2E-010…018 changes. The strict count goes
80 → 81.

**Commits:** the protocol's docs commit, then one story commit.

## Task 1 — the capability probe

New module `src/components/three/sky/hardware-webgl.ts`, colocated with its only consumer, beside
`palette.ts`. It exports `hasHardwareWebGL(): boolean`.

Failing tests first, in `src/components/three/sky/__tests__/hardware-webgl.test.ts`, with
`HTMLCanvasElement.prototype.getContext` mocked (jsdom has no WebGL):
1. a browser that grants `webgl2` only when a performance caveat is allowed (software) → `false`;
2. a browser that grants `webgl2` with `failIfMajorPerformanceCaveat: true` → `true`, and the probe
   context is released through `WEBGL_lose_context`;
3. a browser that grants only `webgl`, not `webgl2` → `false` (three 0.182 is WebGL2-only);
4. no WebGL at all → `false`;
5. `getContext` throws → `false`, nothing escapes.

Change: create a canvas, ask for `webgl2` with `failIfMajorPerformanceCaveat: true`, release the
context if one came back, return whether it did. `try/catch` around the whole probe. No module
cache: it runs once per `SkyBackground` mount.

- [x] Task 1

## Task 2 — the sky draws its shader only on hardware WebGL

Failing tests first, in `src/components/three/sky/__tests__/SkyBackground.test.tsx`, with
`@react-three/fiber`'s `Canvas`, `SkyLayered`, `SkyVolumetric` and `@/lib/hooks/useLenis` mocked:
1. software-only WebGL → no canvas element and no `Canvas` render; the static gradient is
   present;
2. hardware WebGL → the `Canvas` is mounted (the shader path is unchanged).

Change in `SkyBackground.tsx`: `const [canDrawShaderSky] = useState(hasHardwareWebGL);` before the
existing effects; when false, return the wrapper with only the static gradient layer; when true,
render exactly as today. Comment the why: the CI incident, the measured frame cost, and the
visitor class. The existing layer keeps its classes, so all three static renderings stay
identical.

As built: the `Canvas` is rendered under `{canDrawShaderSky && (…)}` inside the existing wrapper
rather than through an early return, so the gradient layer stays one element and the hook order
is untouched. The rendered output is the one planned: the wrapper and the gradient, no canvas. The
three small effects (media queries, hero observer, mouse listener) still run in that state; they
cost nothing measurable (0 ms of long tasks below the fold) and gating them would add three
conditions for no gain. A third test covers "no WebGL at all".

- [x] Task 2

## Task 3 — the CI browser proves it (E2E-019)

New test in `e2e/landing.spec.ts`, inside "Landing Page": "E2E-019: a software WebGL renderer gets
the static sky, not the shader". It loads `/`, waits for the Starter card (the page has hydrated
and the sky's chunk has had time to mount), asserts the precondition in-page (`webgl2` exists but
not without a performance caveat, which is CI's condition and Playwright's default here, with a
message naming it), then asserts `page.locator("canvas")` has count 0. Seen red against the main
build before Task 2's change is built in.

Strict count 80 → 81 in `playwright.config.ts`, every place in `.github/workflows/ci.yml` (the
job comment, the placeholder summary JSON, the step name, `report.expected/total/passed`, the
error string), and `src/__tests__/e2e/playwright-ci-contract.test.ts`, with its history comment.
`CI=1 RUN_RECOPYFAST_CORE_E2E=1 npx playwright test --list | tail -1` reports 81.

Deviation, decided while building: waiting for the Starter card does not prove the sky has
mounted (the sky is a separate dynamic import, so "no canvas yet" is also true of a shader sky
whose chunk has not arrived) and would let the test pass vacuously on main. `SkyBackground`'s
wrapper now carries `data-sky="shader" | "static"`, pinned by the unit tests, and E2E-019 waits
for `[data-sky]` instead. Consequence for the red: on main the test fails at "no `[data-sky]`";
the red for the real reason, `canvas` count 1 instead of 0, is shown on a build with the gate
forced open (Task 4).

- [x] Task 3

## Task 4 — stability evidence

Against a production build with the E2E job's env and the local stack from the research: run
`e2e/landing.spec.ts` (and `hero-demo-mobile.spec.ts`) with `--retries=0 --repeat-each=5`, plus
the frame/long-task probe. Record before/after in the research. Mutation: remove the gate (always
draw the shader), rebuild, and E2E-019 and the unit tests go red; restore.

As built: fixed build 60/60 at `--repeat-each=5`, and 36/36 at `--repeat-each=3` under a
six-core CPU load that leaves about a runner's four cores. The gate-open build under the same
load: 20/24, with E2E-019 red on "1 canvas, expected 0" and the stall reproducing E2E-017's
`page.reload` timeout. Numbers in the research, "After the fix".

- [x] Task 4

## Deviations — review fix pass (minors 2–4)

Rebased on `origin/main` `fc5968b` (s73, deps bump) first; the only conflict was `docs/stories.md`,
both entries kept in id order.

**Minor 2, E2E-019 forces software WebGL itself.** The fix suggested was `test.use({ launchOptions:
{ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } })` in its own describe. Both
halves were checked on Playwright 1.58 and neither works:
- `launchOptions` is a worker fixture, and `test.use` of one inside a describe is a load error:
  "Cannot use({ launchOptions }) in a describe group, because it forces a new worker"
  (`node_modules/playwright/lib/common/fixtures.js:101-103`, reproduced with `--list`).
- `--use-angle=swiftshader` draws on SwiftShader but Chromium reports no major performance caveat,
  so the probe answers "hardware" and the shader sky mounts. What reports the caveat is SwiftShader
  as the WebGL *fallback*, `--use-gl=angle --use-angle=swiftshader-webgl`. Measured with
  Playwright's Chromium on the M1 Max, `webgl2` with `failIfMajorPerformanceCaveat: true`:

| Flags | Headless | Headed |
|---|---|---|
| none (Playwright adds `--enable-unsafe-swiftshader`) | refused (SwiftShader) | granted |
| `--use-angle=metal` (real GPU) | granted (Metal) | granted (Metal) |
| `--use-angle=swiftshader` | granted (SwiftShader) | granted (SwiftShader) |
| `--disable-gpu` | granted | refused |
| `--use-gl=angle --use-angle=swiftshader-webgl` | refused | refused |
| `--use-angle=metal` then `--use-gl=angle --use-angle=swiftshader-webgl` | refused | refused |

As built: E2E-019 launches its own Chromium through the `playwright` fixture, with the configured
`launchOptions.args` followed by `--use-gl=angle --use-angle=swiftshader-webgl
--enable-unsafe-swiftshader` (the last switch wins, last row above), opens a page on the run's
`baseURL` and closes the browser in `finally`. Its assertions are unchanged; the precondition
message now names the flags. CTO decision: an in-test browser rather than moving E2E-019 to a
file of its own with a top-level `test.use`: the test stays in `landing.spec.ts` where the
contract comment and the research point, and it adds to the configured args instead of replacing
them. The strict count stays 81.

Evidence, production build with the E2E job's env (`next start` on 127.0.0.1:3074):
- before this change, E2E-019 passed on Playwright's default headless browser and went red on a
  GPU (`--use-angle=metal` project, M1 Max) at its precondition, `hasWebGL2WithoutCaveat: true`;
- after: 5/5 and 3/3 on the default headless browser, 3/3 on the GPU project, 1/1 headed;
- gate forced open (`{(true || canDrawShaderSky) && (`, rebuilt): red on both the default and the
  GPU project, "toHaveCount: expected 0, received 1".

Local durations include `browser.close()`, which on this Mac takes 2–26 s for any Playwright
Chromium, default flags included; the shared `browser` fixture pays it at worker teardown instead.

**Minor 3, reduced motion pinned.** Two tests in `SkyBackground.test.tsx`: on a GPU, a visitor who
prefers reduced motion gets `frameloop: "demand"`, otherwise `"always"`. They pin behaviour that
already existed, so they passed on first run; mutations `frameloop="always"` and
`frameloop="demand"` each turn one of them red.

**Minor 4, comments.** E2E-019's comment now says E2E-017's `page.reload` timeout was the local
reproduction, and that in CI run 37902163949 E2E-017 passed in 56 s. `hardware-webgl.ts` says
"GitHub's standard GPU-less runners" instead of "every CI runner".
