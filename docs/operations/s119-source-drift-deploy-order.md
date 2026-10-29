# Runbook — shipping s119 (source drift is flagged, not enforced)

s119 ([ADR 075](../decisions/075-source-drift-is-flagged-not-enforced.md)) records when a
developer's deploy changes the source text of an element whose override visitors still see, and
lets a site admin resolve it from the Changes page. Migration:
`supabase/migrations/20261029120000_content_source_drift.sql` — three nullable columns on
`content_elements`, a replaced row-version trigger body, and two service-role functions
(`record_content_source_drift`, `resolve_content_source_drift`).

This is the operator's step, not the implementer's.

## 1. Deploy order — migration first, then the application

This is the same order as [founding-offer.md](./founding-offer.md), and the reverse of
[content-writes-service-role.md](./content-writes-service-role.md).

- **The NEW code breaks on the OLD schema, everywhere at once.** The visitor content read,
  `GET /api/content/[siteId]`, now selects `source_baseline, source_drift_content,
  source_drift_detected_at`. Without those columns PostgREST answers 42703, the route answers
  500, and the widget on **every customer site** falls back to the authored HTML: all published
  copy disappears from every page until the columns exist. The Changes page fails too ("Failed
  to load changes"), and Keep override / Use new source cannot run.
- **The OLD code is unaffected by the NEW schema.** It never names the new columns or calls the
  new functions. The replaced trigger body behaves as before for every write the old code makes
  (it only keeps `updated_at` when nothing but the three new columns changes, and the old code
  never writes them).

So the only broken pair is new code on the old schema, and the order is: apply the migration,
verify it (below), and only then merge the PR.

**In this repository, merging to `main` IS the production deploy** (Vercel Git integration).
Never merge first and migrate "right after": the minutes in between blank published copy on
every installed site (review finding M2).

From the reviewed release checkout, with the Supabase CLI linked to the intended production
project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list **only** `20261029120000` (plus any other reviewed pending migration you
intend to ship in the same step). Stop if the project identity or the list differs. Then:

```bash
supabase db push --linked
```

## 2. Verify with the catalogue, not the ledger

A migration that aborts can still be recorded as applied (see `20260818010000`'s header). Check
the effect, read-only, through the `read-prod-database` path. Both queries must return exactly
what is shown before you merge.

```sql
-- Three rows: source_baseline text, source_drift_content text,
-- source_drift_detected_at timestamp with time zone, all nullable.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'content_elements'
  AND column_name IN ('source_baseline', 'source_drift_content', 'source_drift_detected_at')
ORDER BY column_name;

-- Two rows, both definer = true, and only service_role may execute.
SELECT p.proname,
       p.prosecdef AS definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('record_content_source_drift', 'resolve_content_source_drift')
ORDER BY p.proname;
```

Expected: `anon_exec` and `authenticated_exec` false, `service_exec` true, on both functions.
Anything else: do not merge; the old application keeps working on this schema while you
investigate.

## 3. Merge, then confirm

1. **Merge** the reviewed PR.
2. **Confirm the Vercel production deploy is live** and serves the merge commit (`Ready`, aliased
   to the production domain).
3. **Watch the content read.** `GET /api/content/[siteId]` 5xx in the logs / Sentry must stay
   at its usual level. A burst of `column ... does not exist` means step 2 was skipped or
   checked against the wrong project: roll the deploy back (below) first, then apply the
   migration.
4. **Smoke the Changes page** as a site admin: it loads, and rows without drift look as before.

## 4. Rollback

- **Application only** (the usual case): redeploy the previous production deployment from the
  Vercel dashboard ("Promote to Production"), or revert the merge commit. The migration is
  additive and is safe to leave applied under the old code (section 1).
- **The migration itself** never needs to be reverted to restore service. If it must go, write a
  new forward migration (never edit an applied one) that drops the two functions and the three
  columns, and restores the 20261012122000 body of
  `set_content_element_updated_at_monotonic()`. Ship it only after the application that reads
  the columns has been rolled back, or the visitor content read breaks exactly as in section 1.
