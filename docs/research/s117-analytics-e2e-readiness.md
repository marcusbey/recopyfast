# Research — s117-analytics-e2e-readiness

Post-merge `main` at `245d261`, CI run `38937956626` attempt 1 had 105 clean passes and one
flaky analytics case. The first attempt timed out after 30 seconds in `page.goto` for the
fixture site while waiting for `networkidle`; its retry passed in 2,367 ms. The failed
navigation reached no analytics assertions. A fresh full-job rerun passed 106/106 with zero
failed, skipped or flaky results. The exact held request is unknown.

The local fixture defaults to `awaiting-install`; `SiteProvider` intentionally polls
`/api/sites` at 5,000 ms intervals. The installed Playwright types discourage `networkidle`
and recommend web assertions. The neighboring signed-in CSP test uses `load` plus hydration
assertions. A fresh independent review approved `load`, a visible level-one
`E2E layout site` heading, and a 3,000 ms negative observation matching this file's existing
no-analytics window. Keep listeners installed before sign-in. Do not seed a live site, change
product code, increase timeouts, or weaken the strict reporter. Full behavioral proof requires
disposable Supabase hosted CI; local Docker is unavailable.
