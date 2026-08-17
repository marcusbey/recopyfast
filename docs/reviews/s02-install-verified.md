# Review — Story s02-install-verified

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s02-install-verified` (`1ae1455`).

## Tests
- [x] Run by the reviewer, five full runs. **145 passed / 1 skipped, 2028 tests passed, 0
      failures.** lint 0 errors, `tsc --noEmit` clean, prettier clean. A first run showed 4
      failed suites — the reviewer's own worktree lacked `.env` / `.env.production`; with them
      copied, all four pass. **No flakiness observed**, including in `SiteCard` /
      `SiteDetailView` territory.
- [x] **Bite proven by neutralization — 9 mutations, 8 bit.** Restored between each; final
      `git diff --exit-code` clean at `1ae1455`. The one that did **not** bite is MAJOR 3.

## The eight verification points — all confirmed correct
1. First-contact signal is `POST /api/content/[siteId]` (`route.ts:503`). No
   `/api/analytics/track` anywhere.
2. `stale` is never persisted; exactly one resolver (`resolveEffectiveSiteStatus`), called once
   at `api/sites/route.ts:127`.
3. `stale` gates nothing.
4. The backfill predicate is correct as written — it marks exactly
   `SELECT DISTINCT site_id FROM content_elements`. But see MAJOR 3.
5. The flip fires before `buildDiscoveryRows`, on any authorized POST.
6. Uses `parseOrigin`, not a raw `Referer` — proven by `site-auth-origin.test.ts:399` running the
   *real* `authorizeSiteRequest`.
7. **All four `SiteStatus` consumers updated in step.** Notably `dashboard/page.tsx` carried a
   literal `status === "active"` filter that **the plan wrongly said needed no change**; the
   implementer caught and fixed it.
8. RLS (ALTER, not CREATE — fine under ADR 002), no zod, no applied migration edited.

No `Select` import — the hallucination risk did not materialise. No invented APIs in the diff.

## Findings

### MAJOR 1 — a single swallowed `markSiteLive` write strands a site permanently
A fully-installed site is left `awaiting-install` with **no recovery path**: the widget stops
POSTing once `serverKnownElementIds` is populated (`recopyfast.src.js:2884-2896`), so there is
never a second attempt, and there is no manual recheck in the UI. Since this screen is the
activation gate for the PRD's primary metric, a stranded site reads to the customer as "the
product does not work".

One-line fix: the widget's GET branch already calls `recordSiteReport` under the same auth —
call `markSiteLive` there too.

### MAJOR 2 — the liveness bump is awaited on the content-delivery hot path
`route.ts:352-356` turns the product's **highest-volume read** into a write and serialises
concurrent visitors on one `sites` row lock. The repo already uses `after()` for exactly this
shape at `api/editor/request-code/route.ts:115`.

### MAJOR 3 — the migration backfill is behaviourally untested
Breaking the backfill's join predicate so it marks *every* site `live` — including sites that
never held a single `content_elements` row — produced **zero red tests**. That is the inverse of
the regression the plan and ADR 006 both single out as the critical outcome. The text suite only
regex-matches for `MIN(created_at)` / `GROUP BY`; the `describeDb` suite tests the default and
the CHECK, never the backfill, and was skipped in every run (no Postgres, no Docker).

### Minors
An unused `idx_sites_status` whose comment states something false about the system · two
design-token bypasses (`CardTitle` inlined into a `<p>`, `.text-eyebrow` reimplemented) ·
`SITE_STALE_AFTER_DAYS` undocumented · type drift on `SiteWithStats` · two round trips per POST ·
an unbounded attacker-chosen string writable into `last_mismatch_domain` ahead of the fail-closed
limiter (the token is public by design, so the boundary holds, but it wants a length cap) ·
"since 5 hours ago" copy · a surviving install instruction at `SiteRegistrationModal.tsx:361`,
which matters because this story is meant to own that data as a single source for `s18`.

## Not verified
**The migration has never been applied in this review.** No database, no Docker, `describeDb`
skipped in all five runs — the backfill, the CHECK and the `NOT NULL DEFAULT` on a populated
table are unexecuted SQL. No browser (jsdom only; never compared to the HTML mockup, never dark
mode or 390px). No real widget on a real domain — the whole AC-2 chain is mocked clients. AC-3's
ten seconds is fake-timer evidence only. Clipboard is a `jest.fn()` and `handleCopy` has no
`.catch`.

**Human gestures:** `npx supabase db reset` on seeded data, then compare the `live` set against
`SELECT DISTINCT site_id FROM content_elements`; put the real snippet on a real registered domain
and watch the card turn green untouched, then on a wrong domain to see the mismatch alert; open
all four states against `docs/designs/s02-install-verified.html`.

Housekeeping: the rewritten assertions in `SiteDetailView.test.tsx`, `SiteCard.test.tsx` and
`page.test.tsx` each carry a `REWRITTEN with s02` comment, but AGENTS.md's "say so in the PR" is
still outstanding — `/ks-ship` owes that list.

## Verdict
Max severity: major
Ship allowed: yes
