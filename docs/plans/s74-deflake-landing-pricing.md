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

- [ ] Task 1

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

- [ ] Task 2

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

- [ ] Task 3

## Task 4 — stability evidence

Against a production build with the E2E job's env and the local stack from the research: run
`e2e/landing.spec.ts` (and `hero-demo-mobile.spec.ts`) with `--retries=0 --repeat-each=5`, plus
the frame/long-task probe. Record before/after in the research. Mutation: remove the gate (always
draw the shader), rebuild, and E2E-019 and the unit tests go red; restore.

- [ ] Task 4
