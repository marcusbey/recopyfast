# Ship order — the nine reviewed branches

> ## ✅ ALL NINE SHIPPED, 2026-08-17. This document is now a record, not a plan.
>
> Merged in the order below, deployed, and verified. **2520 tests passing**, type-check clean,
> production build green, migration ledger **50 of 50**, 57 tables all RLS-guarded. Production
> smoke-tested after: `/`, `/api/pricing`, `/login`, `/demo`, `/blog`, `/signup` all 200; the embed
> artifact on production matches the repo byte-for-byte; realtime healthy.
>
> **The order mattered, and both predicted problems occurred exactly as written here:**
> - `s06a`'s gate fired on merge (+19/+18 over, the ADR 023 transport pin). Re-seeded, not raised.
> - The embed artifact conflicted on all three of `s04`/`s11a`/`s14a`, resolved by **rebuilding**
>   from the merged `.src.js` every time — never hand-merged.
> - The ceiling then **ratcheted down** to what the merged tree earned: 46,894 → **46,681**.
>   Predicted net was −196; actual −194.
> - Migrations were applied **before** the deploy, per `s01`'s ordering requirement.
> - `s16`'s migration applied cleanly *because* the schema repair had already created `webhooks`.
>   Without it the file would have aborted and been marked applied.
>
> **Two auto-merges needed manual repair, and one was silent** — worth remembering, because a clean
> `git merge` is not a correct merge:
> - `status-badge.tsx` merged **without conflict** and lost the `CircleSlash` import, which only
>   surfaced as a runtime `ReferenceError` in a test. Nothing flagged it.
> - `server/index.js` conflicted against `s07a`'s factory refactor; its structure was kept and the
>   ADR 023 transport pin re-applied inside it.
> - `s07a`'s own manifest test caught 1.5 MB of untracked `server/server/node_modules` that its
>   Docker build context would have copied wholesale.

> Written 2026-08-17, from measurement rather than inspection. Every number here was produced by
> running the compressor, `git diff --name-only`, and the gate's own constants — not read off a
> report. Reproduce any of it with the commands in each section.
>
> **`/ks-ship` is manual** (`AGENTS.md` § Ship strategy — no `auto`, so the mode is manual). This
> document does not authorize a merge; it makes the merge decision cheap and orders it correctly.

## Gate state

| Story | Severity | Ship allowed |
|---|---|---|
| `s04-retire-graveyard-surfaces` · `s06a-embed-byte-gate` · `s14a-grant-authorized-editing` | minor | ✅ |
| `s01-trial-signup` · `s02-install-verified` · `s07a-realtime-service-hardening` · `s16-webhook-config` | major | ✅ |
| `s05-bulk-content-portability` | **major** (pass 3, fixed at `d172a0c`) | ✅ |
| `s11a-ab-data-plane` | **minor** (re-reviewed `1a1e23c`) | ✅ |

All nine branches are **a single commit** each (`s06a` has two). No rebasing needed; every merge is
a clean squash.

---

## ⛔ Finding — the byte gate protects nothing until it merges, and two branches breach it

`s06a` committed a hard build gate with `MAX_BUNDLE_GZ = 46875` and `MAX_WIDGET_GZ = 34063`
(`scripts/build-embed.mjs:91-92`), seeded from `main`'s **exact** current size — so the artifact
sits at the ceiling with **zero headroom by construction**.

That gate lives only on `feature/s06a-embed-byte-gate`. Every other branch was cut from `main`,
where `build-embed.mjs` has no gate at all. **A gate on an unmerged branch cannot fire on any
branch but its own.**

Measured with the same compressor the gate uses (Node `zlib.gzipSync`, level 9), on
`public/embed/recopyfast.js` at each branch tip:

> **⚠ The `main` baseline moved on 2026-08-17 — re-seed `s06a`'s constants when it merges.**
> Pinning the embed to `transports: ['websocket']` (ADR 023) cost **+19 gz bytes**, so `main` is now
> **46,894**, nineteen above `s06a`'s committed `MAX_BUNDLE_GZ = 46875`. `s06a`'s gate would fail on
> merge. That is the ratchet working, not a defect: the constant was seeded from `main` and `main`
> changed. Re-seed both constants from the then-current `main` **and itemise the delta in the commit
> message** — do not raise them to whatever makes the build pass. The +19 is one line of code and is
> accounted for.

| Ref | gz bytes | vs ceiling 46,875 |
|---|---|---|
| `main` (before the transport pin) | **46,875** | exactly at it |
| `main` (now) | **46,894** | **+19** — the ADR 023 transport pin |
| `feature/s04-retire-graveyard-surfaces` | **45,894** | **−981 — the only branch that frees bytes** |
| `feature/s11a-ab-data-plane` | **46,933** | **+58 over** ❌ |
| `feature/s14a-grant-authorized-editing` | **47,602** | **+727 over** ❌ |

```bash
for ref in main feature/s04-… feature/s11a-… feature/s14a-…; do
  git show $ref:public/embed/recopyfast.js > /tmp/a.js
  node -e "const z=require('zlib'),f=require('fs');console.log(z.gzipSync(f.readFileSync('/tmp/a.js'),{level:9}).length)"
done
```

**`s11a` was caught** — its review flagged the breach, its fix run cut the overage from 74 to 58 and
correctly raised no constant, and its re-review reproduced **+58 exactly** and passed it as
ship-allowed on the understanding that ordering absorbs it (see below).
**`s14a` was not.** It carries `Ship allowed: yes` at 727 bytes over. That is not a reviewer error:
`s14a` was judged against `main`, and on `main` no ceiling exists. It is a **merge-order** defect,
and it is invisible from inside any single branch.

`s04` is the counterweight — it retires graveyard surfaces, so it *removes* widget code and frees
981 bytes. Merging it before the two additive branches is what makes them fit.

**Gzip deltas are not additive.** Gzipping a concatenation is not the sum of gzipping its parts, so
`−981 + 58 + 727 = −196` is an *estimate*, not a guarantee. **Re-measure after every merge**; do not
plan the sequence on arithmetic.

### Byte allocation for `s11a` — resolved by ordering, at zero cost

`s11a`'s fix run reduced its overage from 74 to **58** gz bytes and, correctly, raised no constant.
It escalated three ways out: sequence `s06c-embed-shrink` first, raise both ceilings by an itemised
58, or merge `s11a` first and re-seed. **None is necessary.** `s04` frees **981** bytes, which is
sixteen times what `s11a` needs. Merging `s04` first absorbs `s11a` (+58) and `s14a` (+727) together
with room left over.

The escalation was right to happen — from inside `s11a`'s branch, `s04`'s headroom is invisible.
This is the merge-order view supplying an answer the branch could not reach. `s06c` stays available
if the re-measure disagrees, and remains the correct instrument if the artifact ever genuinely needs
to shrink.

Its accounting is worth keeping: the overage is **entirely** Task 3's fallback sort (37) and M3's
geo guard (23), both mandated. The bug fix and Task 8 were free — reusing the string
`'ReCopyFast: A/B bucketing unavailable'` is **−11** on its own, because neighbouring text already
contains those words. Five cheaper spellings were built and measured; four were rejected on
correctness (dropping `!!` diverges from the server's `Number(Boolean())`; a `?-1:1` tiebreak is an
invalid comparator), one taken. 58 bytes is 2.9% of the ≤2,000 gz this document's own budget
(`docs/stories.md:101`) allocates to A/B bucketing.

---

## Recommended order

Two independent clusters. Within a cluster order matters; across clusters it does not.

### Cluster A — the embed artifact

`public/embed/recopyfast.js` is a **build artifact** touched by three branches, so git will conflict
on it every time. **Never hand-resolve it** (AGENTS.md non-negotiable 1). Take either side
arbitrarily, then rebuild from the merged `.src.js` and commit the rebuild. The `.src.js` conflicts
are the real ones.

1. **`s06a`** — install the gate first, so everything after it is actually measured. Merging it
   later means merging blind and discovering the breach at the end.
2. **`s04`** — frees 981 bytes; the only source of headroom available.
3. **`s11a`** (+58) then **`s14a`** (+727) — combined +785 against 981 of headroom. Re-measure at
   each step. If either fails, `s06c-embed-shrink` is the story that exists to create room; do not
   raise the constant to make a merge pass.

### Cluster B — dashboard and database

Migration timestamps are already distinct and monotonic, so they dictate the order and there is no
collision to resolve:

1. **`s01`** — `20260817000000_trial_entitlements.sql`
2. **`s02`** — `20260817001000_sites_install_status.sql`
3. **`s16`** — `20260817003000_webhook_dispatch_and_secrets.sql`
4. **`s05`** — no migration; ship-allowed at pass 3. **Merge it after `s16`**: the review found the
   plan's `<select>` citation stale, because `design-system.md` records gap 6 as closed by `s16` and
   names `s05` as the consumer that inherits `select.tsx`'s `bg-transparent` drift.

`s07a` touches neither cluster meaningfully and can go any time.

### All nine are now ship-allowed

Nothing is gated on a review any more. What remains before a merge is **ordering** (this document)
and the operator gestures below — not further pipeline work.

---

## Conflict surface — measured, and small

Only **nine files** are touched by more than one branch:

| File | Branches |
|---|---|
| `public/embed/recopyfast.src.js` + `.js` | `s04` `s11a` `s14a` |
| `src/components/ui/status-badge.tsx` | `s02` `s05` `s16` |
| `src/components/dashboard/SiteDetailView.tsx` (+ test) | `s02` `s05` `s16` |
| `src/types/index.ts` | `s05` `s16` |
| `src/app/dashboard/page.tsx` | `s01` `s02` |
| `src/app/dashboard/sites/page.tsx` | `s02` `s04` |
| `jest.setup.js` | `s05` `s07a` |

`status-badge.tsx` and `SiteDetailView.tsx` are the two genuine three-way merges. Both are ordinary
source files — resolve them normally, then run the suite.

---

## ⛔ Schema comes before any of this

The database was probed on 2026-08-17 (`node scripts/check-schema.mjs`). **17 tables that live code
queries do not exist**, because five migrations aborted in full and are marked applied. Nine
previously-unapplied migrations have since been applied; the ledger is at 41 of 43.

**`20260818000000_repair_aborted_migrations` must be applied to production before two of these
stories deploy:**

- **`s16-webhook-config`** — its migration has **zero `CREATE TABLE` statements** and its first
  statement is `ALTER TABLE webhooks`. `webhooks` does not exist, so the file would abort, be marked
  applied, and kill the feature permanently.
- **`s14a-grant-authorized-editing`** — built on `site_editors`, ships no migrations. Merging is
  harmless; the feature simply cannot work until the table exists.

Two security migrations are also blocked on that repair —
`20260809120000_lock_down_definer_functions` (needs `purge_expired_editor_artifacts()`) and
`20260813140000_site_permissions_delete_per_row` (needs `site_permissions.granted_by`).

## Before the first merge

**`s01` needs migration-before-deploy ordering.** Its review found the entitlement chokepoint throws
for paying accounts if the code lands before the migration applies. That is a deploy-sequencing
requirement, not a merge one — but `s01` is first in cluster B, so it is the first place it bites.

**Merging `s11a` puts the schema probe in the tree.** `scripts/check-ab-schema.mjs` is tracked only
on `feature/s11a-ab-data-plane`. It is the instrument for the largest open unknown in this codebase
— whether the RLS tenant boundary ADR 002 depends on is actually in place — and it has never been
run. That is a reason to merge `s11a` early rather than late.

**Fix `NEXT_PUBLIC_APP_URL` before `s17`.** It is set to the apex, which 308s, and only
`getPublicAppUrl` canonicalises it — so every sitemap, robots and canonical URL currently redirects
(QA register D-1, 2026-08-17). Setting the env var to `https://www.recopyfa.st` fixes sixteen call
sites at once. The SEO cluster stories publish through this same path and would inherit the defect
at scale.
