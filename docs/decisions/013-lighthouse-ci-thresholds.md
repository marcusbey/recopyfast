# ADR 013 — Lighthouse CI job and numeric Core Web Vitals thresholds for cluster pages

- Status: accepted
- Date: 2026-08-16
- Scope: story s17-cluster-engine

## Context

`s17` AC 7 requires: *"Each page passes Core Web Vitals thresholds in a Lighthouse run in CI."*
`docs/research/s17-cluster-engine.md` and `docs/designs/s17-cluster-engine.md` both confirm: no
Lighthouse/CWV tooling exists anywhere in this repo (`package.json` scripts, `.github/workflows/`,
no `lighthouserc*`), and no numeric threshold is stated anywhere in `prd.md`, `architecture.md`,
or `stories.md` — "passes... thresholds" has no number behind it. Both docs recommend the planner
either supply the number or send the question back up before task breakdown. This ADR supplies it,
so `/ks-execute` has something falsifiable to build against instead of discovering the gap
mid-implementation.

## Decision

- **Tool:** `@lhci/cli` (`lhci autorun`), configured via a committed `lighthouserc.json`. New CI
  job (or step appended to the existing `ci` job in `.github/workflows/ci.yml`), following the
  `e2e` job's existing shape — the only precedent in this repo for booting a real built server in
  CI (`npm run build` + `npm run start` + wait-on) — then running Lighthouse against each of the
  5 seeded `/alternatives/<slug>` URLs plus the `/alternatives` route itself.
- **New npm script:** `npm run lighthouse:ci`, so the same command runs locally and in CI.
- **Numeric thresholds** (Lighthouse's lab metrics — the only kind a CI run can produce; there is
  no field/RUM data pre-deploy):
  - Performance category score ≥ **90**
  - Largest Contentful Paint (LCP) ≤ **2500 ms**
  - Cumulative Layout Shift (CLS) ≤ **0.1**
  - Total Blocking Time (TBT) ≤ **200 ms** — the lab proxy for Interaction to Next Paint (INP);
    INP itself is a field-only metric and cannot be produced by a CI Lighthouse run.
  These are the standard "Good" CWV boundaries Google publishes for LCP and CLS, and TBT ≤ 200ms
  is the commonly used lab proxy for a "Good" INP (< 200ms) — not invented figures.
- **Scope of the gate:** applies to `/alternatives/*` now; `s18`/`s19` extend the same
  `lighthouserc.json` URL list when their routes exist, rather than each story standing up a
  second Lighthouse job.

## Considered options

- **Real-user (RUM/CrUX) Core Web Vitals instead of lab Lighthouse.** Rejected for this AC
  specifically: RUM data only exists post-deploy, so it cannot block a PR in CI. (The PRD's
  separate "publish our own CWV as a sales page" item, noted in `stories.md`'s "Not stories,
  deliberately," is a different, later, RUM-based artifact — not this gate.)
- **No numeric threshold — run Lighthouse, report the score, don't fail the build.** Rejected:
  unfalsifiable, the same defect class `docs/reviews/stories.md` already flagged elsewhere (four
  criteria deferred the number that would make them testable). A report nobody reads is not a gate.
- **Reuse `s06`'s embed byte-gate mechanism (`scripts/build-embed.mjs`) for this.** Rejected: wrong
  artifact. `s06`'s ceiling is `public/embed/recopyfast.js`, the third-party embed bundle; these
  are ordinary server-rendered marketing pages with no relationship to that budget
  (`docs/research/s17-cluster-engine.md`, "Traps & constraints").

## Consequences

- The first real CI run against `/alternatives/*` is also the first real evidence of whether
  these thresholds are achievable on the design doc's chosen surface (sky/slate palette, no
  `SkyBackground`/`useLenis`/`framer-motion` — a deliberate hedge already recorded in
  `docs/designs/s17-cluster-engine.md`, "Design system gaps," item 4). If the thresholds prove too
  tight against real measurements, tightening or loosening them is a new ADR superseding this one,
  not a silent edit to `lighthouserc.json`.
- `s18`/`s19` inherit this gate for free by adding their URLs to the same config — they do not
  need their own ADR unless they need different thresholds for a structural reason (e.g., an
  index/chooser page with a larger grid).
