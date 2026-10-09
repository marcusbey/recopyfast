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
| Dump | `pg_dump` **custom format** of the `public`, `auth` and `storage` schemas |
| Connection | the Supabase **session pooler**, `aws-0-us-east-2.pooler.supabase.com:5432`, from the `DATABASE_URL` Actions secret of the backups repository |
| Encryption | [`age`](https://age-encryption.org), to **one recipient** (a public key — not a secret) |
| Retention | workflow artifacts, kept **30 days** |

What it does **not** contain: the files people uploaded. The `storage` schema holds the bucket
and object *rows*; the bytes live in Supabase's object store and are not in a `pg_dump`.

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

The file names below are placeholders — the workflow in the backups repository is the source of
truth for the artifact and file names.

1. **Download** the artifact of the run you want:

   ```sh
   gh run list -R marcusbey/recopyfast-backups --workflow nightly-db-backup.yml --limit 5
   gh run download <run-id> -R marcusbey/recopyfast-backups -D ./restore
   ```

2. **Decrypt** without writing the key to disk:

   ```sh
   age --decrypt \
     -i <(security find-generic-password -s recopyfast-backup-age-key -w | xxd -r -p) \
     -o ./restore/recopyfast.dump ./restore/<file>.age
   ```

3. **Inspect** it: `pg_restore --list ./restore/recopyfast.dump | head -50` — the three schemas
   and their tables should be listed.

4. **Restore into a new database.** The dump expects Supabase's roles (`anon`, `authenticated`,
   `service_role`, …) and the `auth`/`storage` schemas Supabase manages, so the closest target is
   a local Supabase stack (`supabase start`) or a new, throwaway Supabase project. Restore the
   application schema first:

   ```sh
   pg_restore --no-owner --no-privileges --schema=public \
     --dbname="<new database url>" ./restore/recopyfast.dump
   ```

   `auth` and `storage` already exist in a Supabase database; restore their *data* only
   (`--data-only --schema=auth`, then `--schema=storage`) and expect to resolve conflicts with
   rows the new project created itself. Errors naming Supabase-internal roles on a vanilla
   PostgreSQL are expected — that is why a Supabase target is recommended.

5. **Verify** before believing it:
   - row counts of `sites`, `site_permissions`, `content_elements`, `plans` and `auth.users`
     against the source;
   - a known site's published copy is there;
   - RLS is enabled on the restored tables (`select relname, relrowsecurity from pg_class …`).

6. **Then decide.** Pointing the app at a restored project means changing
   `NEXT_PUBLIC_SUPABASE_URL`, the anon key and the service-role key in Vercel and on Fly — an
   owner decision, never a side effect of a drill.

Drill it once a quarter: a backup nobody has restored is a hope, not a backup.
