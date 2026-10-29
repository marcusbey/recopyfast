---
validated: yes
story: s121-tools-owner-ctas
---
# Owner next step on every free-tool result

Validation source: Owner request 2026-10-24: 'can we start implementing the solutions' (14-day plan experiment 5: owner versions of the free tools; experiment 4: ship s99)

Goal: turn the free tools into an owner lead path (research:
`.omc/gtm/research/site-owner-angle-2026-10-22.md`, experiments 4 and 5). Branch
`feature/s99-outdated-checker-ship` (s99 merged onto main `230a0ea6`). Embed allocation 0 bytes.

- [x] Copy in `src/lib/tools/cta-copy.ts` (`ownerCtaCopyFor`): "Fix these yourself in a minute"
      when the result found something, otherwise "Change your own website text". The body says
      the preview is desktop-only and that keeping a change needs the one-line install, by the
      owner or their developer. Links: `/try?…#install`, `/for/owners?…`, with
      `utm_campaign=owner_path&utm_content=<slug>`.
- [x] `src/components/tools/OwnerNextStep.tsx`: native anchors (report documents run under the
      nonce CSP), `primary` or `secondary` emphasis, `cta_click` attributes per anchor.
- [x] Report page (`/tools/<slug>/r/<id>`): findings → owner step first, primary; no findings →
      after `ToolCta`, secondary.
- [x] `CostCalculator`: owner step under a complete result, secondary; the page's freelancer CTA
      stays the main one. Owner mode skipped: not cheap and not truthful as copy alone (the
      figure is "unbilled" time of a freelancer).
- [x] `datafast-goals.ts`: `tool_outdated_checker_run` (dedicated tool goal for
      `outdated-website-checker`), CTA target `owners`, locations `typo_finder_result`,
      `outdated_checker_result`, `cost_calculator_result`, `dataFastToolResultLocation(slug)`.
      ADR 074 amended.
- [x] Tests: `OwnerNextStep.test.tsx`, report page ordering and attributes, calculator owner step,
      goal taxonomy, boundary-link file list.
- [ ] Gates: lint, type-check, format, full Jest, production build; independent review.
