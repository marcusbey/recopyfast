# Database backups

**Why this exists.** The Supabase project is on the Free plan, which has **no backups and no
point-in-time recovery** (checked 2026-10-09). Without this job, a dropped table, a bad migration
or a deleted project is unrecoverable. Supabase Pro would add managed daily backups (and PITR as
an add-on); if the plan is upgraded, keep this job until a managed restore has been drilled.

Set up by the orchestrator on 2026-10-09. This page is the runbook; it holds no secret.

## What runs

| | |
|---|---|
| Repository | `marcusbey/recopyfast-backups` — **private**, separate from this public repo |
| Workflow | `nightly-db-backup.yml`, every night at **03:17 UTC** |
| Dump | `pg_dump --format=custom --no-owner --no-privileges` of the `public`, `auth` and `storage` schemas, from a `postgres:17` container (production is PostgreSQL 17) |
| Connection | the Supabase **session pooler**, `aws-0-us-east-2.pooler.supabase.com:5432`, from the `DATABASE_URL` Actions secret of the backups repository |
| Encryption | [`age`](https://age-encryption.org), to **one recipient** (a public key — not a secret) |
| Retention | workflow artifact `recopyfast-db-backup`, one file `recopyfast-<UTC timestamp>.dump.age`, kept **30 days** |

What it does **not** contain:

- the files people uploaded. The `storage` schema holds the bucket and object *rows*; the bytes
  live in Supabase's object store and are not in a `pg_dump`;
- **any privilege.** `--no-privileges` leaves out every GRANT and REVOKE, so the column boundary
  that keeps `sites.api_key` from members (ADR 033) is not in the backup. It comes back from
  `supabase/migrations` — see [Restoring](#restoring).

## Where the secrets are

Nothing below is in any repository.

| Secret | Where | Read it with |
|---|---|---|
| The age **decryption key** | the owner's macOS Keychain, service `recopyfast-backup-age-key`, stored **hex-encoded** | `security find-generic-password -s recopyfast-backup-age-key -w \| xxd -r -p` |
| The database password | the owner's macOS Keychain, service `recopyfast-supabase-db` | `security find-generic-password -s recopyfast-supabase-db -w` |
| `DATABASE_URL` | Actions secret of `marcusbey/recopyfast-backups` (write-only) | — |

**Lose the age key and every backup is unreadable.** Keep a second copy outside this Mac
(a password manager entry or a printed copy in a safe place).

## Rotating the database password

The backup job is the only thing here that uses the database password (the app talks to
Supabase with API keys). So a rotation has two follow-ups, both the same day — otherwise the next
night's run fails:

1. Update the Keychain entry `recopyfast-supabase-db` with the new password.
2. Update the `DATABASE_URL` secret of the backups repository with the new connection string:
   `gh secret set DATABASE_URL -R marcusbey/recopyfast-backups` (it prompts for the value; never
   pass it on the command line).

Then run the workflow once by hand (`gh workflow run nightly-db-backup.yml -R
marcusbey/recopyfast-backups`) and check it is green.

## Is it working?

- A failed scheduled run emails whoever last edited its schedule — that is GitHub's own rule.
- Look at the backups repository's Actions tab once a week: the last run green, an artifact
  attached.
- Artifacts expire after 30 days: a month of failed runs means **no backup at all**.

## Restoring

**Restore into a NEW, empty database first, verify it, and only then decide about production.**
Never `pg_restore --clean` into production on a hunch: take a fresh dump of production's current
state before touching it.

**The schema and its privileges come from `supabase/migrations`; the backup supplies rows only.**
A Supabase project grants `anon` and `authenticated` everything on every table and function
created in `public` (its default privileges). Production takes those grants back through the
migrations: table-level REVOKEs, explicit column lists, EXECUTE revoked on the definer functions
(ADR 033, AGENTS.md Non-negotiable 9). Restoring the dump's own schema skips all of that:
`sites.api_key`, `webhooks.secret` and the key hashes become readable by any member, and every
SECURITY DEFINER function callable with the public anon key — the s38 incident, everywhere at
once. Keeping privileges at restore time would not help either: this backup has none
(`--no-privileges`), and even a dump that kept them writes its GRANTs relative to PostgreSQL's
built-in defaults, so nothing would take Supabase's defaults back.

Measured on 2026-10-09 (s84 review) on PostgreSQL 17, with the repository's Supabase fixture
(`scripts/db/bootstrap-supabase-fixtures.sql`) and all 72 migrations as "production", each
target a fresh database with the fixture alone (a new project), the first and third rows from a
dump with the nightly job's exact flags, the second from one that kept its privileges, and the
checks of step 6 run as written:

| Restore | Secret columns readable by `anon`/`authenticated` | Definer functions exposed | Web-role grants differing from production |
|---|---|---|---|
| `pg_restore --no-owner --no-privileges` (this page before s84, and the backups README) | 8 of 8, to both | 96 | 424 |
| the dump's schema with its privileges kept | 8 of 8, to both | 63 | 314 |
| **migrations, then data only (below)** | **0** | **0** | **0** |

RLS was enabled on every table in all three — which is why the old step 5, an RLS check, would
have certified the first two. Not yet run against a hosted Supabase project: the first quarterly
drill is that check.

The exact schema-first/data-only commands below were rehearsed again on 2026-10-10 with a fresh,
disposable PostgreSQL 17.11 source/target pair and all 73 current migrations. Synthetic
`auth.users`, site, permission and content rows kept equal source/target counts; published copy was
preserved; the step 6 privilege/function/RLS SQL returned zero rows; and effective web-role column
grants matched. The ignored operator evidence is
`.omx/ultragoal/evidence/s84/restore-proof/{local-drill.py,result.json}`. This was a local synthetic
drill, not an encrypted production-artifact decrypt, auth identities/storage parity, hosted
Supabase or provider restore, so it does not clear the quarterly hosted drill above. A separate
read-only metadata check found scheduled run `38043247098` green with one unexpired 859,958-byte
artifact; its contents and credentials were not downloaded.

The backups repository's `README.md` must describe this same procedure. Until s84 its step 5 was
`pg_restore --no-owner --no-privileges -d "<target url>" recopyfast.dump` — the first row above.
If the two ever disagree, this page wins.

1. **Download** the artifact of the run you want:

   ```sh
   gh run list -R marcusbey/recopyfast-backups --workflow nightly-db-backup.yml --limit 5
   gh run download <run-id> -R marcusbey/recopyfast-backups -n recopyfast-db-backup -D ./restore
   ```

2. **Decrypt** without writing the key to disk:

   ```sh
   age --decrypt \
     -i <(security find-generic-password -s recopyfast-backup-age-key -w | xxd -r -p) \
     -o ./restore/recopyfast.dump ./restore/recopyfast-<timestamp>.dump.age
   ```

3. **Inspect** it: `pg_restore --list ./restore/recopyfast.dump | head -50` — the three schemas
   and their tables should be listed.

4. **Build the schema from the migrations.** The target is a new, throwaway Supabase project, or
   a local stack (`supabase start` applies `supabase/migrations` itself; skip the push). Use the
   migrations production had when the dump was taken — normally `main` at that date. Connect
   through the direct connection or the session pooler (port 5432), never the transaction pooler
   (6543): the load below is one long session.

   ```sh
   supabase db push --db-url "<new database url>"
   ```

5. **Load the rows, in one transaction.** `session_replication_role = replica` (the setting
   Supabase's own restore guide uses) turns triggers and foreign-key checks off for the load, so
   rows land exactly as dumped — `staging_access`'s BEFORE INSERT trigger and `content_elements`'
   AFTER INSERT trigger would otherwise rewrite them. The migrations seed `plans`, `copy_styles`,
   `founding_offers` and one `sites` row, so `public` is emptied first, inside the same
   transaction; any error rolls everything back.

   ```sh
   pg_restore --data-only --schema=auth --table=users --table=identities \
     -f ./restore/auth-data.sql ./restore/recopyfast.dump
   pg_restore --data-only --schema=public -f ./restore/public-data.sql ./restore/recopyfast.dump
   psql "<new database url>" -At -c "SELECT 'TRUNCATE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ';' FROM pg_tables WHERE schemaname = 'public'" \
     > ./restore/empty-public.sql
   psql "<new database url>" --single-transaction -v ON_ERROR_STOP=1 \
     -c 'SET session_replication_role = replica' \
     -f ./restore/empty-public.sql -f ./restore/auth-data.sql -f ./restore/public-data.sql
   ```

   A missing-column error means the migrations do not match the dump: use the ones from the
   dump's date. Not restored, on purpose: the other `auth` tables (sessions, refresh tokens, MFA
   — people sign in again) and the `storage` rows (the migrations recreate the `assets` bucket,
   and object rows would point at files the dump does not hold).

6. **Verify** before believing it:
   - **privileges** — each query must return **zero rows**:

     ```sql
     -- Secret columns a web role can read (ADR 033).
     SELECT s.tbl || '.' || s.col AS secret_column, r.role AS readable_by
     FROM (VALUES ('sites', 'api_key'), ('webhooks', 'secret'), ('api_keys', 'key_hash'),
                  ('editor_device_grants', 'grant_hash'), ('editor_device_grants', 'user_agent_hash'),
                  ('editor_device_grants', 'origin_hash'), ('staging_access', 'verified_user_agent_hash'),
                  ('staging_access', 'verified_origin_hash')) AS s (tbl, col)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (role)
     WHERE has_column_privilege(r.role, format('public.%I', s.tbl), s.col, 'SELECT');

     -- Definer functions a web role can call, beyond the three RLS predicates (A-3, A-5).
     SELECT p.oid::regprocedure AS definer_function,
            CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS executable_by
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
     WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace AND a.privilege_type = 'EXECUTE'
       AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) = 'anon'
            OR (pg_get_userbyid(a.grantee) = 'authenticated'
                AND p.oid::regprocedure::text NOT IN ('user_has_site_permission(uuid,text[])',
                    'user_is_team_member(uuid)', 'user_has_team_role(uuid,text[])')));

     -- Tables without RLS.
     SELECT relname FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity;
     ```

     The column list is `HIDDEN_COLUMNS` in `src/__tests__/db/column-privileges.test.ts` and the
     allowlist is `RLS_PREDICATE_ALLOWLIST` in `src/__tests__/db/function-grants.test.ts`: when
     either changes, change it here too;
   - row counts of `sites`, `site_permissions`, `content_elements`, `plans` and `auth.users`
     against the source;
   - a known site's published copy is there.

7. **Then decide.** Pointing the app at a restored project means changing
   `NEXT_PUBLIC_SUPABASE_URL`, the anon key and the service-role key in Vercel and on Fly — an
   owner decision, never a side effect of a drill.

Drill it once a quarter: a backup nobody has restored is a hope, not a backup.
