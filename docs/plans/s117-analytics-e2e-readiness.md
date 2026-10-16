---
validated: yes
---

# Plan — s117-analytics-e2e-readiness

## Evidence and scope

Post-merge CI 38937956626 on main 245d261 failed its strict 106-test gate with 105 clean
passes and one flaky result. The first attempt of the signed-in dashboard analytics test
exhausted its 30-second timeout in page.goto waiting for networkidle; its retry passed in
2,367 ms. No analytics/CSP assertion failed. The exact held request is not captured by the
credential-redacted CI artifact and is not claimed as known.

The fixture creates an awaiting-install site. SiteProvider intentionally polls /api/sites
every five seconds. Installed Playwright documentation discourages networkidle for testing.
The signed-in CSP spec already uses load plus UI/hydration assertions on this same route.
A fresh independent read-only review approved the following bounded approach.

## Implementation plan

1. Use a new isolated branch/worktree from current main; preserve all existing worktrees.
   Register the next available story id and carry this validated plan into its canonical path.
2. Change only the affected navigation in e2e/google-analytics.spec.ts from networkidle to load.
3. Assert the level-one heading E2E layout site is visible, proving the authenticated site
   overview loaded, and observe for 3,000 ms before the existing negative analytics assertions.
   This window matches the existing no-analytics observation elsewhere in the same spec.
   Keep request/response listeners installed before sign-in, all CSP/dataLayer/runtime-request
   assertions, fixture state, browser count 106, timeout, retries and strict zero-flaky gate.
4. Run type checks, relevant analytics component/route tests, test-discovery count and normal
   repository gates. Validate the changed behavior in required disposable Supabase hosted E2E;
   an unchanged rerun is not proof for the repair. No production credentials or provider calls.
5. Obtain independent source review, open a PR and require hosted CI/Lighthouse. No dependencies,
   migrations, product code or threshold changes. Manual merge remains a separate decision.

## Independent plan review

Reviewer analytics_wait_review: approve the one-file readiness/observation change. No product
bug is proven; do not change the site fixture to live or hide the flake with timeout increases.
Local Docker is unavailable, so hosted disposable-stack proof is required.

## Human checkpoint

Owner selected “Validate the test-only repair” on 2026-10-16. Covers implementation, review, PR and CI; not merge.
