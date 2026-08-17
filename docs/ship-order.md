# Ship order — the nine reviewed branches

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
| `s05-bulk-content-portability` | critical → **re-review in flight** | ❌ |
| `s11a-ab-data-plane` | major → **fix in flight** | ❌ |

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

| Ref | gz bytes | vs ceiling 46,875 |
|---|---|---|
| `main` | **46,875** | exactly at it |
| `feature/s04-retire-graveyard-surfaces` | **45,894** | **−981 — the only branch that frees bytes** |
| `feature/s11a-ab-data-plane` | **46,933** | **+58 over** ❌ |
| `feature/s14a-grant-authorized-editing` | **47,602** | **+727 over** ❌ |

```bash
for ref in main feature/s04-… feature/s11a-… feature/s14a-…; do
  git show $ref:public/embed/recopyfast.js > /tmp/a.js
  node -e "const z=require('zlib'),f=require('fs');console.log(z.gzipSync(f.readFileSync('/tmp/a.js'),{level:9}).length)"
done
```

**`s11a` was caught** — its review flagged the breach and its fix run is addressing it.
**`s14a` was not.** It carries `Ship allowed: yes` at 727 bytes over. That is not a reviewer error:
`s14a` was judged against `main`, and on `main` no ceiling exists. It is a **merge-order** defect,
and it is invisible from inside any single branch.

`s04` is the counterweight — it retires graveyard surfaces, so it *removes* widget code and frees
981 bytes. Merging it before the two additive branches is what makes them fit.

**Gzip deltas are not additive.** Gzipping a concatenation is not the sum of gzipping its parts, so
`−981 + 58 + 727 = −196` is an *estimate*, not a guarantee. **Re-measure after every merge**; do not
plan the sequence on arithmetic.

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
4. **`s05`** — no migration; merge after its re-review passes.

`s07a` touches neither cluster meaningfully and can go any time.

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

## Before the first merge

**`s01` needs migration-before-deploy ordering.** Its review found the entitlement chokepoint throws
for paying accounts if the code lands before the migration applies. That is a deploy-sequencing
requirement, not a merge one — but `s01` is first in cluster B, so it is the first place it bites.

**Fix `NEXT_PUBLIC_APP_URL` before `s17`.** It is set to the apex, which 308s, and only
`getPublicAppUrl` canonicalises it — so every sitemap, robots and canonical URL currently redirects
(QA register D-1, 2026-08-17). Setting the env var to `https://www.recopyfa.st` fixes sixteen call
sites at once. The SEO cluster stories publish through this same path and would inherit the defect
at scale.
