# Review — s117-analytics-e2e-readiness

Date: 2026-10-16 (Toronto). Fresh independent review of the uncommitted story candidate on
`feature/s117-analytics-e2e-readiness` against base
`245d2612297582730d981a6e1270597c0017b8af`, the human-validated plan, research, repository rules
and accepted analytics/CSP decisions.

## Verdict

No open findings. The implementation is the bounded test-only repair the plan authorized.

The affected signed-in navigation now waits for `load`, then waits for the exact visible level-one
`E2E layout site` heading before observing the page for 3,000 ms. That locator is grounded in the
real route: `createLayoutOwnerFixture` seeds that exact site name, `SiteProvider` resolves the
requested site, `useSitePageShell` supplies `site.name` as the shell title, and `PageHeader` renders
the title as the page's h1. The fixed observation window matches the existing negative-analytics
window in this spec and is appropriate here because the expected event is an absence; it begins only
after authenticated route readiness rather than substituting time for readiness.

Both listeners remain installed before sign-in. The document-CSP collection, per-policy Google-host
refusal, `dataLayer`/`gtag` absence, intercepted Google-request absence and init-script request
absence all remain unchanged after the new observation window. The awaiting-install fixture, test
timeout/retry configuration, strict reporter and expected browser inventory are unchanged. No
product, analytics runtime, consent, cookie, CSP, dependency, migration, provider or production-data
path changed, so the patch does not widen the analytics or privacy boundary.

## Plan and source binding

The reviewed behavioral source scope is exactly one file: `e2e/google-analytics.spec.ts`, 14 added
lines and one replaced line relative to the base. Its reviewed SHA-256 is
`e81e764192a662d17c9d8d0953968c172d09f52a3ab7a0b84ae091f79518b073` and its Git blob is
`1fe32bd86e81425a6a0cf220835eea7cd130ce8c`. The accompanying story registration, research and
validated plan were also reviewed; no other source or configuration file was in the diff.

Plan tasks 1–3 are represented exactly. Task 4 is locally evidenced where this environment allows
and still correctly reserves the changed browser behavior for the disposable hosted stack. Task 5
remains the post-review PR/CI phase; manual merge is outside this review.

## Independent verification

- Node `v24.14.0`: `npm run type-check` passed.
- Targeted ESLint for `e2e/google-analytics.spec.ts`, Prettier check and `git diff --check HEAD`
  passed.
- Playwright discovery remained exactly **106 tests in 22 files**, including the changed signed-in
  analytics case.
- With CI's documented `NEXT_PUBLIC_APP_URL=http://localhost:3000`, Jest passed **540 suites / 8,068
  tests**, with one suite and two environment-gated tests skipped. An initial run without that CI
  variable exposed one unchanged CORS test's environment assumption; the route and its test are
  byte-identical to `HEAD`, and the CI-equivalent rerun passed.
- Installed Playwright 1.58 types confirm `load` is a supported `goto` readiness value and mark
  `networkidle` as discouraged for testing in favor of web assertions.

## Mutation proof and verification limits

The only changed executable behavior is itself a hosted Playwright assertion/wait. A meaningful
neutralization would require executing this signed-in case against Next plus the disposable
Supabase stack. Local ports 3000, 54322, 6379 and 4001 were closed and Docker was unavailable, so I
did not claim a vacuous mutation result from test discovery or from a failure before the mutated
line. Hosted CI must run the changed branch and show the strict **106 passed, 0 failed, 0 skipped, 0
flaky** summary; an unchanged-main rerun is not evidence for this repair. No meaningful mutation
proof was performed: removing an assertion would not be expected to make an otherwise correct page
fail, and deliberately corrupting the selector would only prove that Playwright rejects a false
locator. The required remaining evidence is the planned changed-branch hosted 106-test run, not
additional mutation infrastructure.

I did not run the production build, Lighthouse, the seven-test built-embed job, a production or
provider call, deployment, commit, push, PR or merge. Those remain author/hosted shipping gates.

Max severity: none
Ship allowed: yes
