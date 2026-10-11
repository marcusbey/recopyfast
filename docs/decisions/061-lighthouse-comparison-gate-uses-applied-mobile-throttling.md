# ADR 061 — The comparison Lighthouse gate uses applied DevTools mobile throttling

- Status: accepted (owner decision, 2026-10-11)
- Date: 2026-10-11
- Scope: story `s17-cluster-engine`
- Supersedes: ADR 013 only where its unspecified throttling method otherwise selects
  Lighthouse's default simulated Lantern measurement
- Preserves: ADR 013's tool, routes, five-run median policy and four numeric thresholds

## Context

ADR 013 fixed a falsifiable Lighthouse CI gate but did not name a throttling method. Lighthouse
12.6.1 therefore used its default `simulate` method: it observed an unthrottled loopback trace and
used Lantern to infer mobile performance. After removing one unused font preload, all eight
comparison routes still measured performance 88–89 and LCP 3,735–3,892 ms. CLS and TBT passed.

Two bounded product probes did not repair that result. Removing the root loading boundary left the
simulated LCP effectively unchanged. Global inline CSS increased the HTML to 436,832 bytes and
worsened median LCP to roughly 4,030–4,036 ms. Both probes were restored.

The same source was then measured with Lighthouse's supported `devtools` method, which applies the
mobile network and CPU constraints to the browser and reports the observed metrics. Forty reports
(five per route) measured performance 98–99, LCP 1,643–1,679 ms, CLS at or below 0.0107 and TBT
82–94 ms. That diagnostic build predates the later `dynamicParams = false` real-404 repair, so it
establishes the method difference, not final acceptance.

The two result sets are not interchangeable. Applied mode keeps the numeric acceptance limits but
changes measurement semantics; passing it does not make the simulated deficit irrelevant.

## Decision

The committed comparison gate uses Lighthouse applied DevTools mobile throttling with:

- `throttlingMethod: "devtools"`;
- mobile 412 x 823 screen emulation at device scale 1.75;
- 562.5 ms request latency, 1474.56 Kbps download and 675 Kbps upload;
- 4x CPU slowdown;
- five sequential runs for the hub and every registry detail URL; and
- median assertions of performance >= 0.90, LCP <= 2500 ms, CLS <= 0.1 and TBT <= 200 ms.

The config also records Lighthouse's paired 150 ms RTT and 1638.4 Kbps simulated values so the
resolved profile is complete. Every emitted JSON report must prove the exact method, form factor,
screen, throttling values, requested/final URL and finite required metrics before its scores count.

Sentry's s46 contract is unchanged. `src/instrumentation-client.ts` keeps its static import and
synchronous initialization before hydration. The Lighthouse fixture intentionally leaves its DSN
unset; it is neither live telemetry evidence nor permission to gate Sentry out of production.

## Options considered

- **Keep simulated Lantern and continue product micro-optimizations.** Rejected for this gate. The
  three measured probes isolated the inferred graph behavior without finding a source regression,
  while further churn would pressure the accepted Sentry and visual contracts.
- **Lower LCP or performance thresholds, reduce the run count, or change aggregation.** Rejected.
  Those are the acceptance bar established by ADR 013; this decision preserves them.
- **Omit the DSN or delay/dynamically import Sentry.** Rejected. The fixture already has no DSN,
  and Next does not await asynchronous `instrumentation-client` work before hydration.
- **Treat the pre-404 applied diagnostic as final proof.** Rejected. Final source and hosted CI are
  separate evidence lanes.

## Consequences

- Applied throttling is more sensitive to runner CPU, background load, Chromium and request
  scheduling. The pinned Playwright browser, sequential runs, five-run medians, exact report-profile
  validation and two same-SHA hosted calibration runs bound that risk.
- Lighthouse expands non-simulated quiet windows to 5,250 ms. The diagnostic 40-report run took
  about 17 minutes; the workflow's 45-minute timeout remains subject to hosted confirmation.
- An LCP-ceiling mutation to 1 ms must fail while retaining 40 structurally valid reports. Restoring
  2500 ms and the approved profile must then produce a clean final-source run.
- Task 6 remains open until the post-404-fix source passes locally and two current-head hosted runs
  pass on the same commit. This remains lab evidence, not field INP, CrUX, RUM or production proof.
