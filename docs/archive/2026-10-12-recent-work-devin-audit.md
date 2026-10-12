# Recent-work and Devin audit — 2026-10-12

This report reconciles current Git, recent `.omc` work, the October 11 `.omx/ultragoal` recovery
snapshot, open pull requests and deferred Devin findings. It is an audit, not release proof. No
production mutation, merge, charge or external message was performed while preparing it.
One failed Vercel preview was safely retried with an explicit preview target; it is not production proof.

## Evidence boundary

- **Current repository:** fetched `origin/main` is `bc6e503` (`#95`). The operator-local primary checkout remains clean at `f4ecaa8`, three commits
  behind. This audit worktree started clean at `bc6e503` on branch
  `codex/devin-review-followups`.
- **Live GitHub coordination evidence:** the leader confirmed the open/merged PR set and the #91
  failing job details on 2026-10-12. Those facts are newer than the checked-in `.omx` snapshots.
- **`.omc` and `.omx`:** local orchestration, queue and recovery artifacts. They prove what was
  recorded locally at that time; they do not prove current GitHub, CI, deployed or provider state.
- **Production:** not rechecked in this audit. Any live acceptance listed below remains unknown
  until a fresh attended check proves it.

## Current result

Merged into `origin/main`: **#84, #85, #86, #87, #88, #89, #92, #93 and #95**.

Open: **#81, #90, #91, #94, #96, #97, #98 and #99**.

The four approved code repairs are implemented and independently reviewed. The remaining delivery
sequence is:

1. complete the pending hosted checks: #94 has a queued Vercel preview and a running Lighthouse
   job; #99 has a running Lighthouse job. All other hosted checks are green, and all six updated
   PRs have zero current private Devin bugs/vulnerabilities/flags;
2. make the manual merge decisions for #81/#94/#96–99, applying database migrations in the
   documented order before dependent route rollout;
3. repair #91's ESM test-runtime failure and inspect the actual nested development advisories;
4. refresh #90 after #81 merges and run its two attended Stripe TEST checkouts;
5. finish the remaining free tools, publish the local retrospective docs, and complete fresh
   production acceptance as separate lanes.

## Open PRs — exact remaining gates

### PR #81 — `s82-billing-lifetime-guards`

Remote head now: `a1491f0`, pushed and verified on GitHub. Repair commit `5f3c4a1` carries the
source fix; the final integration also carries the stronger regression and independent review.
Current-main integration preserves both appended story records. The Devin thread is resolved.

The newest Devin finding is real: the prior “amount warned before” lookup could be cut off by
PostgREST's row cap and had legacy string/number ordering to account for. The active local repair
has been simplified to one invoice-scoped paged read that accepts both numeric and legacy string
amounts while preserving the existing alert and stored amount formats. Local full hooks are green with the CI app URL:
495 suites, 7,370 tests and 38 gated skips on the final integrated head.

The independent re-review is now `Max severity: none / Ship allowed: yes`. The focused webhook
suite passes 230/230. Removing the invoice filter fails two tests; removing numeric normalization
fails three. The reviewer also found and repaired a weak pagination fixture: the highest previous
amount now falls on page two, and a first-page-only mutant fails on the actual alert amount. The
first full hook run had one unrelated CORS failure because local `NEXT_PUBLIC_APP_URL` was absent;
using CI's documented localhost value made the affected 42-test suite and the full hook pass
without changing any assertion.

Remaining:

- current-head CI is green; manual merge remains;
- merge only with `Ship allowed: yes` on the final head;
- provider/live billing acceptance remains separate from source readiness.

PR #90 is downstream and must not be refreshed against an intermediate #81 head.

### PR #90 — `s25-stripe-test-entitlement-e2e` (draft)

Recorded head: `641a1a0`. Its base is the s82 feature branch, not current main, and the October 11
source/CI evidence predates the later #81 repairs.

Remaining:

- wait for the final #81 merge, then refresh/retarget to current main;
- start the isolated Stripe CLI TEST listener and inject only its ephemeral signing secret into
  the owned local test process;
- complete **two fresh user-attended TEST Checkout passes** end to end;
- clean every captured Stripe test object and ephemeral database/auth fixture and prove cleanup;
- run hooks/CI on the refreshed exact head;
- fresh final review; the current review correctly says `Ship allowed: no` until provider proof;
- any live payment remains a distinct financial checkpoint and is not authorized by TEST proof.

No unattended historical run, mock or expired checkout window substitutes for those two passes.

### PR #91 — Dependabot `uuid` 11 → 14

The diff is limited to `package.json` and `package-lock.json`, but the failure is not “generic red
CI”. Job `114724171995` in run `38223184014` reached Jest and failed seven suites with
`SyntaxError: Unexpected token 'export'`; 477 suites passed and 2 skipped. The failing set includes
the owner-plan gate and bulk import/import-outcome/roundtrip/update suites. Coverage and
DB/PostgREST verification consequently failed, and E2E never reached execution.

The evidence points to uuid 14 ESM compatibility with this Jest/test-runtime graph. Remaining:

- research whether the production imports and Jest transformer/module mapping support uuid 14;
- choose a compatible import/runtime configuration or keep the current major; do not paper over
  the failure by excluding suites or lowering coverage;
- rebase the one-package diff onto current main;
- rerun all gates, including DB/PostgREST and the E2E job that previously never ran;
- normal dependency review before merge.

No code change belongs in this audit branch; it needs its own validated dependency scope.

GitHub's current default-branch alert inventory also has five **development-dependency** alerts:
two high `extract-zip` alerts (#188/#189, no patched version listed), high/low `tmp` alerts
(#187/#186), and medium `uuid` (#85). The lockfile locates the old uuid at
`@lhci/cli/node_modules/uuid` 8.3.2; the top-level production/shared uuid is already 11.1.1.
Therefore upgrading the direct dependency to 14 is not itself proof that the nested Lighthouse
advisory is fixed. The dependency follow-up must inspect the actual resolved tree and retain the
distinction between developer tooling exposure and production dependencies.

### PR #94 — `s107-google-analytics`

Recorded remote head at audit start: `12da10d`. The reported Devin issue — an early calculator completion could consume
the once-per-page-view flag before analytics was active — is fixed at that head. The independent
F1–F7 repair set is also recorded there. Missing story/research/design documentation and the stale
review footer were repaired in the sibling s107 lane; their absence in older snapshots is not a
new runtime defect. The report Cookie settings control was already correctly hidden at `12da10d`;
the stale GitHub thread was resolved during this audit. The #92 rounding thread was also resolved
after verifying its existing fix.

A fresh independent review of the repaired sibling state now returns `Max severity: none` and
`Ship allowed: yes`. Its evidence includes 86 initial targeted tests and 586 independent targeted
tests; those are not a full-suite count. Document/CSP guard and fail-closed consent mutations
produced 22 and 12 failing tests respectively, and all mutations were restored. Retrospective
research/design/HTML reference and review are committed in `b0ddad8`; main integration is `0e36c1a`.
The integrated normal hook passed 499 suites / 7,331 tests with 38 gated database skips. The
production build and coverage gate passed during the normal pre-push checks. `0e36c1a` is pushed
and verified as the PR head.

Remaining:

- current-head CI is green; manual merge remains;
- retain manual acceptance as explicit limitations: real-domain GA cookie deletion, one real scan
  reaching GA Realtime/Tag Assistant before navigation, non-EEA performance with gtag loaded,
  phone-size banner/focus visibility, admin setting read-back and unlocatable/Tor GeoIP behavior.

A fresh manual Devin analysis of `0e36c1a` found zero runtime bugs/vulnerabilities and one new
ADR-immutability flag. The two older missing-docs/pending-review flags were resolved after verifying
the committed research, design and none/yes review footer. The docs-only superseding ADR 069 repair has passed independent review and 263 focused
tests; committed/pushed at `c024368` with normal hooks green. Fresh Devin analysis of `c024368` is now zero bugs/vulnerabilities/flags; the final Lighthouse run and queued Vercel preview remain. It changes no product behavior.

The s107 review documents the GA4 property, stream, retention and Production-only Vercel variable as
configured/read back. That current branch evidence supersedes earlier `.omc` notes that stopped at
GA data-collection setup.

## Merged recent work and stale Devin dispositions

These items should not be reopened as active code defects unless new evidence reproduces them:

- **#92 / s98:** merged at `9541589`; fractional inputs, cents and visible rounding were fixed at
  `05bdbca`. The real gap was missing research/design artifacts. They are now reconstructed
  retrospectively in operator-local research/design records, explicitly without inventing pre-build
  dates. Publication note: those records are available for review in [PR #100](https://github.com/marcusbey/recopyfast/pull/100).
- **#88 / s06b:** the old PR/e2e count in review prose is historical. The later head updated the
  strict count to 93; no current count defect follows from that stale sentence.
- **#82 / s77:** cache policy and guard documentation findings were fixed; its review is current.
- **#79 / s75:** architecture now records the 74% coverage floor. The older percentage finding is
  stale.
- **#78 / s73:** the story research exists; an “absent research” flag is stale.
- **#74:** the design artifact exists; an “absent design” flag is stale.
- **#72 / s66c1:** the re-review record is current.
- **#70 / s66b1:** `src/components/ui/page-shell.tsx` is deliberately lower-case because it is an
  existing UI primitive convention, not a missing PascalCase component migration.
- **#65 and #66 planning-other-stories flags:** historical process notes, not unresolved runtime
  defects. PR #65's actual unclosed D2 is separately scoped as s69a below.

## Approved deferred Devin repairs

The owner validated all four scopes in the operator-local plan
`docs/plans/devin-deferred-findings-2026-10-12.md` (not included in this archive). Each
now has its own canonical validated plan, branch, implementation, regression evidence, independent
review and PR:

1. **s65b / #96 `74f4251`:** retires unused revision-rotation triggers/functions, retains the
   private column, and proves site deletion no longer deadlocks with content editing.
2. **s69a / #97 `34709b5`:** deduplicates historical conversions by the approved survivor rule and
   makes concurrent conversion inserts atomic with a partial unique index and service-only RPC.
3. **s81 / #98 `e848654`:** Discard carries the exact reviewed row version, performs database CAS,
   rejects null versions, and returns conflict with refresh and no automatic retry.
4. **s67b / #99 `a57bf70`:** composes parent/child edits and restores late-discovered ancestors
   without losing descendant copy or depending on mapping order. The existing byte ceilings and
   discovery protections remain intact.

No production migration or merge is authorized by the local implementation approval. Deploy s65b
before s81; deploy s69a and s81 migrations before their dependent route code.

## Other known flags — disposition, not a combined backlog

### #64 snapshot/revision flags

- Updating `sites.public_content_revision` also moves `sites.updated_at`; no current runtime
  revision consumer was found. s65b completed the consumer census and updated-at regression coverage in #96.
- The lock inversion is reproduced. A separate verifier applied the current migration verbatim to
  a disposable PostgreSQL 17 minimal schema, held the content child lock in the edit transaction,
  let the product-shaped site delete hold the parent, then released the barrier. The delete ended
  with SQLSTATE `40P01`; the edit succeeded. No production call was made; the disposable cluster was cleaned. #96 now commits the deterministic regression and the
  forward retirement migration; independent mutation review restores the deadlock when the old
  triggers return. A bounded delete-only retry was rejected because it leaves the lock graph.
- Every page snapshot includes all site-wide shared rows. One site can therefore exhaust the
  1 MiB response ceiling on every page. This is documented intentionally in
  `docs/architecture/published-snapshot.md`: refuse the whole oversized response, never silently
  truncate. It is a product/storage limit to monitor, not an unrecorded bug fix in s65b.

### #67 legacy-boundary flags

Registration-layout coverage is mocked, and old collaboration dialogs are dormant. Those are
legacy/frozen-boundary limitations, not acceptance for the active product surface. If either flow
is revived, it needs current real-layout/real-route evidence; this audit does not promote them into
an active story by itself.

### #71 visual proof

Signed-in app-page captures remain missing. CI exercised behavior but uploaded no authenticated
captures. This is outstanding visual evidence, not proof that the layout code failed.

### #77 Discard race

Repaired in #98 with database compare-and-set and exact row versions. The new null-token bypass
also has a reviewed fix at `e848654`. Deployment remains pending; page-local locks and a final
read alone never provided this guarantee.

### #80 renderer detection

The generic renderer probe remains an unknown limitation: it cannot prove every renderer or
failure shape, and renderer-probe exceptions previously needed explicit cleanup. Keep it recorded
as a compatibility caveat; do not claim a reproduced current defect without a target renderer.

### #83 blog archive gap

The blog index intentionally shows the newest 100 published posts. Sitemap paging is fixed beyond
PostgREST's row cap, but a reader has no UI path from the index to article 101+. That is a product
archive/navigation gap, not a sitemap data-loss bug.

## Free-tools pipeline after #92/#93/#95

| Story                     | Current pipeline evidence                                                              | Remaining                                                            |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| s96 free-tools platform   | merged; research, design, validated plan, review                                       | production/tool acceptance only                                      |
| s96c streamed HTML        | merged; research, validated plan, review                                               | production regression watch                                          |
| s98 calculator            | merged; validated plan, review; research/design backfilled locally and retrospectively | preserve/review the documentation backfill; no source defect         |
| s97 CSP checker           | validated plan only; no canonical research/design/review                               | research → design → execute → review → ship                          |
| s99 outdated-site checker | validated plan only; no canonical research/design/review                               | research → design → execute → review → ship                          |
| s100 AI-slop checker      | validated plan only; no canonical research/design/review                               | research → design → execute → review → ship                          |
| s101 alt-text checker     | validated plan only; no canonical research/design/review                               | research → design → execute → review → ship; claims-ledger row first |

The open decisions in `.omc/plans/open-questions.md` remain product/operations decisions, not
implementation evidence. The most immediate are the bouncing support address, the s101 claims row,
privacy/terms wording, Turnstile timing, report retention/capacity and attribution.

## `.omc` recent-work snapshot

`.omc/project-memory.json` is an access/structure cache, not a completion ledger. Its hot paths
correctly point at recent s82 and free-tools work but cannot establish merge, review or deployment.

Recorded local GTM state:

- `recopyfast-1147pm` video: `video-post.json` says posted and owner-approved, with an X URL;
- the newer `5am-job` render assets exist, but no posting-queue file names them — “unposted” is an
  inference, not external proof;
- X posting queue: six items marked approved;
- Reddit queue: one item marked posted, eleven approved/pending;
- X growth state: zero recorded days, engagements and posted-bank entries, with no stop flag;
- `TICK.md` defines pacing and stop rules. It is a plan, not evidence the scheduled interactions
  ran or remain safe under platform automation policy.

Fresh external publication/account checks are required before reporting any queue item as live.

## `.omx` recovery snapshot caveat

`.omx/ultragoal/recovery-progress.md` and `goals.json` were correct recovery records on October 11,
but are not the current PR ledger:

- G011 still says s17 pending even though #89 merged.
- G003 says s82 complete, meaning its earlier source-readiness checkpoint; #81 remains open and
  acquired later fixes.
- G010/s25 remains genuinely in progress.
- G008 combined acceptance/release remains pending.

Never derive current merge or release status from those goal labels alone.

## Local worktree and preservation inventory

Snapshot captured during this audit; active lanes may change it after this file is written.

- Primary root: clean `main` at `f4ecaa8`, three behind `origin/main`.
- `codex/devin-review-followups`: based on `bc6e503`; owns only this audit, the s98 backfill and the
  deferred-findings proposal.
- s82: repair, regression and review committed/pushed at `a1491f0`; worktree clean.
- s107: runtime/documentation integration at `0e36c1a`; reviewed ADR-history follow-up committed at
  `c024368`, pushed with normal hooks green; worktree clean.
- s03: seven dirty planning/design/research entries; plan `validated: no`, no review.
- s11b: three dirty planning/design/research entries; plan `validated: no`, no review.
- s49: six dirty code/doc entries, but the story is explicitly superseded by s51. Preserve or
  archive it; do not ship it as s49.
- s25: clean draft-PR worktree, still provider-blocked.
- s06b, s17, s79 and s89: clean historical branch worktrees after their PRs merged.
- s96d-typo-precision: clean at current main with **no s96d PR evidence**. Treat it as a reserved or
  pending lane, not a redundant merged-work cleanup candidate.
- detached deploy-main worktree: historical release evidence, not current serving-version proof.
- five Git stashes remain, plus eleven dated worktree-backup directories under
  `.omx/worktree-backups/2026-10-11`. They are preservation artifacts, not active acceptance.

Cleanup may happen only after the active owner confirms that a worktree/stash has no remaining
purpose. This audit deletes nothing.

## Closing delivery evidence

| Branch update           | Local verification                                                                                                                       | Remote state                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #81 `a1491f0`           | Normal commit/push hooks passed: lint, typecheck, format, build, 495 suites / 7,370 tests, 77.04% line coverage; 38 database-gated skips | Pushed; description refreshed; newest Devin billing thread resolved; new-head CI green; not merged                                                       |
| #94 `c024368`           | Normal commit/push hooks passed: lint, typecheck, format, build, 499 suites / 7,331 tests, 76.12% line coverage; 38 database-gated skips | Pushed ADR-history repair; normal hooks and fresh private Devin green; Lighthouse running / Vercel preview queued; other hosted checks green; not merged |
| #92 existing fix        | Existing rounding fix checked; no new calculator source change                                                                           | Stale fractional-input thread resolved                                                                                                                   |
| Audit/s98 documentation | Four Markdown files pass Prettier; no tracked diff whitespace errors                                                                     | Saved in this worktree, not committed or published                                                                                                       |

The owner answered **"Validate all four recommended plans"**. Implementation and review are now
authorized; production migrations and merging are still excluded. All four have dedicated reviewed implementations and ready PRs. #96/#97/#98 have green checks;
#99 is pushed; fresh Devin reports zero bugs/vulnerabilities/flags, with hosted CI still running. Deploy the s65b database repair before s81.
No repository default branch, production database, production deployment or payment was changed.

## Four approved fixes — current review state

| Story / PR                                                    | Head / state     | Verified outcome                                                                                                                                                                                                   | Remaining gate                                                       |
| ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [s65b / #96](https://github.com/marcusbey/recopyfast/pull/96) | `74f4251`, ready | Independent review none/yes; PostgreSQL 17 114 passed / one intentional skip; full Jest 6,948 passed; hosted checks green; Devin zero bugs/vulnerabilities/flags (private panel checked)                           | Manual merge and production migration                                |
| [s69a / #97](https://github.com/marcusbey/recopyfast/pull/97) | `34709b5`, ready | Independent review none/yes; PostgreSQL 17 129 passed / one intentional skip; full Jest 6,951 passed; hosted checks green; Devin zero bugs/vulnerabilities/flags (private panel checked)                           | Manual merge; migration before route rollout                         |
| [s81 / #98](https://github.com/marcusbey/recopyfast/pull/98)  | `e848654`, ready | CAS and null-version repair reviewed; PostgreSQL 17 133 passed / one skip; full Jest 6,968 passed / 38 skips; all hosted checks green; latest private Devin zero bugs/vulnerabilities/flags                        | Manual merge; s65b migration then s81 migration before route rollout |
| [s67b / #99](https://github.com/marcusbey/recopyfast/pull/99) | `a57bf70`, ready | Nested composition and late-parent restoration reviewed; full Jest 6,964 passed / 38 skips; focused 155/155; generated Chromium 7/7; independent review none/yes; fresh Devin clean; bundle/widget 45,769 / 32,992 | Only Lighthouse running, then manual merge                           |

All counts above use Node **24.14.0** and its gzip implementation. A managed-worktree default
of Node 25 initially gave different embed byte results; those measurements were discarded and
validation rerun with the repository runtime. The s67b bundle/widget ceilings remain
**45,801 / 33,044 bytes**; the latest reviewed artifact is 45,769 / 32,992. No discovery protections were removed to fund its implementation.
The separate product target of a bundle no larger than 30,000 bytes gzipped is still unmet;
passing the existing ratchet is not evidence that this longer-term size target is complete.

PR #98's initial Vercel preview failed before building with `git_info_fail`; a preview-only
retry succeeded. Its earlier Lighthouse run measured TinaCMS TBT 207.093 ms against a 200 ms
ceiling; the new-head run at `e848654` passed without weakening that ceiling.

Two local hook attempts encountered Jest-worker `SIGSEGV` crashes. The unchanged normal hooks
passed on retry, with no skipped gate, relaxed assertion, coverage change or hook bypass.

All six final feature worktrees are clean and their reviewed commits are pushed. The primary
checkout remains untouched and clean; `origin/main` is still `bc6e503`.

## Production and attended acceptance still separate

Merges and green CI do not close G008. Fresh evidence is still needed for the actual serving
versions and the full user journey, including:

- authenticated owner/invited-editor edit, save, publish and reload on the real
  `www.aicompoz.com` homepage, including SPA and cross-device behavior;
- Vercel and Fly serving revisions, realtime credential/CSP behavior and public embed degradation;
- the two s25 Stripe TEST purchases before any live-payment decision;
- Sentry/uptime alert delivery and a real backup-restore exercise;
- private blog generation and authorized human publication;
- GA real-domain/provider checks after #94 is reviewed and merged.

No invitation, fixture, preview deployment, migration file, review footer or local queue proves
those production outcomes by itself.

## Overall project remaining criteria — outside this audit task

The audit documents the following remaining project work. The approved four repair scopes have
their own implementation branches; this report does not claim the wider release gates are done:

1. #81, #90, #91 and #94 are either merged through their gates or explicitly closed with a recorded
   disposition;
2. #96–99 receive manual merge dispositions after final checks, with production migration order
   s65b before s81 and each new RPC migration before dependent route rollout;
3. s97/s99/s100/s101 are either completed through the pipeline or explicitly reprioritized;
4. G008's attended provider/production checks are recorded against exact serving versions; and
5. publish/review the local s98 retrospective research/design documentation;
6. the bundle reaches the separate 30,000-byte gzip product target; and
7. preserved dirty/stashed work is classified and cleaned up without losing user work.
