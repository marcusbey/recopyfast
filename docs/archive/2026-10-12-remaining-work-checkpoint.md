# Remaining-work checkpoint — 2026-10-12, 15:59 UTC

This supplements the earlier `2026-10-12-recent-work-devin-audit.md` snapshot. It records new
verified outcomes and remaining gates; it is not a claim that production acceptance is complete.

## Reviewed code and hosted checks

| PR                    | Head      | Current evidence                                                                        |
| --------------------- | --------- | --------------------------------------------------------------------------------------- |
| #81 billing           | `a1491f0` | Reviewed; required hosted checks green; fresh private Devin panel clear                 |
| #94 analytics         | `c024368` | Reviewed, including immutable ADR-history repair; required checks and preview now green |
| #96 revision locks    | `74f4251` | Reviewed; required hosted checks green; private Devin panel clear                       |
| #97 conversion dedupe | `34709b5` | Reviewed; required hosted checks green; private Devin panel clear                       |
| #98 Discard integrity | `e848654` | Reviewed, including null-version refusal; required checks and preview green             |
| #99 nested editing    | `a57bf70` | Reviewed, including late-parent restoration; required checks and preview green          |

The previously pending #94/#99 Lighthouse and #94 Vercel items are complete. All six current
private Devin panels report zero bugs, vulnerabilities and flags. The neutral Vercel Agent Review
status is not being counted as an independent approval.

The s98 retrospective research/design backfill and its independent review are now available for review in
[PR #100](https://github.com/marcusbey/recopyfast/pull/100), head `ea0f9c4`. That PR changes three
documentation files only. Its 99 focused tests and normal Node 24 hooks passed, including all
6,948 Jest tests, build and coverage; 38 database-gated tests were skipped by the normal local
suite. New hosted checks were still running at this checkpoint.

No PR has been merged by this goal. No production migration or deployment was initiated by it.

## Release readiness and boundary

A concrete six-PR release batch has passed independent review. Its three forward migrations are
hash-pinned and sequenced with s65b before s81, and each new RPC exists before its caller rolls out.
The operator wrapper passed 11 independent disposable-PostgreSQL checks, including transactional
DDL/ledger rollback, version ordering under lock, duplicate preservation, concurrent-executor
refusal and non-writing RPC probes. The owner has been asked to authorize the actual batch;
that approval remains separate from implementation and review.

Read-only production preflight confirmed the three new versions are absent, four old revision
triggers remain, and the new conversion/CAS objects are absent. Aggregate duplicate conversion
groups and null content versions were both zero. The wrapper refuses nonzero duplicate groups
under its write lock, so the proposed batch does not authorize deletion of conversion rows.
Backup metadata showed a recent successful, unexpired encrypted artifact; no production-backup
decrypt/restore drill is claimed.

## Source work still pending

- **Dependency repair:** reviewed plans propose native operation UUIDs in the two bulk routes
  (s108), followed by narrow Lighthouse UUID/tmp overrides (s109). Human validation is pending.
  Feature-branch audit proof can show that three alerts would be remediated; actual Dependabot
  closure is a post-merge check. The two unpatched development-only `extract-zip` alerts require
  explicit, time-limited acceptance or a separately reviewed Lighthouse-major migration.
- **Attended Stripe TEST acceptance:** #90 still depends on #81 merging, a refreshed branch,
  two fresh user-attended checkouts, webhook/entitlement proof and complete fixture cleanup.
- **Remaining free tools:** s99's outdated-site research/design/repaired plan passed independent
  review and awaits human validation. The s97 CSP, s100 phrase and s101 alt-text stories still
  need their remaining pipeline work and concrete rule decisions. No provider or production
  acceptance is inferred from their planning documents.
- **Embed target:** the complete reviewed artifact is 45,769 bytes gzipped. The separate
  30,000-byte product target remains unmet. The feasibility report records measured savings and
  preserves full-payload accounting; native transport alone is not yet evidence of meeting it.
- **Production acceptance:** real owner/invited-editor edit/save/publish/reload, SPA/cross-device
  behavior, serving revisions, provider/alert/restore checks and real-domain analytics remain
  separate from source and CI readiness.

## Framing and preservation findings

A fresh full-backlog review found that an older “AI translation is built” statement conflicts
with later stories and the reachable Languages route, which ignores `autoTranslate`; the
translation dashboard has no non-test importer. The global story review remains critical/no
until a credible planned throughline or explicit owner scope decision resolves that gap. This
checkpoint does not silently add a translation implementation to the current work program.

The preserved-work inventory covers 23 worktrees at capture, five stashes and eleven backup
directories. New goal-owned publication/research lanes may appear afterward. Most preserved
bundles contain unmatched work and remain retained. The empty release backup and exact-redundant
s33 backup are strong archive candidates only after ownership/disposition proof. No stash,
backup or historical worktree was applied, discarded or archived.

The remaining-work goal stays active. Pending authorizations, prepared releases, local tests and
documentation publication do not substitute for their required production or attended outcomes.
