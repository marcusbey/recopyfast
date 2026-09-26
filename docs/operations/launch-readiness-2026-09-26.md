# Launch readiness — 2026-09-26

Run by the operator's directive of 2026-09-25 ("keep going … until tested live in production and
ready to launch"), from the founder's hands-on test. Every change went through research → plan →
TDD → fresh-context review → CI (incl. 44/44 Playwright) → merge → deploy → **live test on
https://www.recopyfa.st**. Live scripts: `.omx/qa-20260925/` (not committed).

## Shipped and proven live

| Story / PR | What changed | Live proof |
|---|---|---|
| s38 · #35 | Site HMAC keys, webhook secrets, API-key hashes and device-grant hashes no longer readable by collaborators or anon (column grants) | `has_column_privilege` false for `authenticated`/`anon`; health green |
| repair · #36 | `api_keys.site_id` missing in production although the ledger said applied | Column present; ledger at `20260925120000` |
| s39 · #37 | **All sites** in the editor bar; `/edit` resumes the session; 7-day hub when Remember ticked; Remember unticked by default; sign-out | Full journey on two sites; cookie 7.00 d httpOnly/Secure/Lax; sign-out clears |
| s43 · #38 | `/blog` hydration error fixed; `/pricing` → `/#pricing` | 308 incl. query; no errors in fr/ja/en-US locales |
| s42 · #39 | API keys can be created, paused, deleted; a key dies when its creator stops being admin; ADR 037 | Create/list/pause/delete; paused/deleted key 401 |
| s40 · #40 | AI suggestions work for owners and invited editors, charged to the site owner (ADR 035); unmetered auto-translate removed | 200 + suggestions for both; 1 credit each on the owner; site-token-only 401 |
| s41 · #41 | Owner edit links and share links survive reloads and navigation (sessionStorage, ADR 036); editor bar fits phones | Edit mode after reload and clean-URL nav; new tab visitor |
| s44 · #43 | Public content API served 429 to every request (limiter queried columns that never existed) | First call 200; exactly 100/min then 429 on real Redis |

Embed: **46,635 → 45,883 gz** (−752) while adding the features above; ceilings ratcheted down each time.

## Open — not blocking launch
- s41: a three-page save/publish walk and the share-link walk need a multi-page site with the
  snippet in its layout (both QA sites serve it on one page).
- Minors logged in each `docs/reviews/s3x/s4x-*.md`: DB-outage 401 signs link editors out (s41);
  per-key vs per-site limiter needs an ADR note (s44 m2); refund-failure message and post-charge
  re-read (s40); no cap on keys per site (s42 m3); AI suggestions arrive wrapped in quotes; the AI
  modal's gradient button breaks the design system.
- Operator decisions: rotate site tokens / webhook secrets exposed before s38 (only QA sites exist);
  limit AI credits or seats on the $299 lifetime Founding Agency; Sentry project not visible to
  the connected Sentry org.
