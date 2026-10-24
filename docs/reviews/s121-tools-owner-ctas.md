# Review — s121 owner CTAs on tool results

- Date: 2026-10-24
- Reviewer: independent fresh-context reviewer (read-only), branch `feature/s99-outdated-checker-ship` at 93e29ad1
- Verdict: PASS-WITH-FIXES — Max severity: major — Ship allowed: yes

## Findings and resolution

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | major | `OWNER_FIX_HEADING` "Fix these yourself in a minute" overpromised: the preview saves nothing and keeping a change needs the one-line install, often by a developer. | Heading is now "Fix these yourself once ReCopyFast is on your site"; the body no longer opens with "You don't need to wait on your developer". |
| 2 | minor | With findings, two stacked cards both link to `/try#install`. | Accepted. The two links carry separate `cta_click` locations, so DataFast shows whether the repeated ask costs clicks. Revisit with data. |
| 3 | minor | ADR 074 `cta_click` table row omitted the `owners` target and the `*_result` locations. | Row updated. |

Verified by the reviewer: goal params are categorical only (the scanned URL never reaches a goal, UTM or attribute); UTMs encoded; card a11y; report pages stay dynamic; s118 DataFast attributes and the s120 header link intact; sitemap/llms/canonicals catalogue-driven.
