# Review — s65b-site-delete-revision-lock-order

Independent review of `origin/main` `bc6e503` through `4aca6fe`, followed by verification of
the comment-only finding repair in the working tree. The review compared the implementation with
the human-validated plan, research, ADR 046, ADR 064 and the repository rules. No source was
changed by the reviewer.

## Findings

No open findings.

### Closed — migration atomicity tombstone corrected

`supabase/migrations/20261012120000_retire_public_content_revision_rotation.sql:26-30` now states
that the enclosing `DO` is atomic and that a failure rolls back both `REVOKE` and `DROP`. It
accurately assigns partial-schema/retry convergence to the `to_regprocedure` checks. The follow-up
diff changes comments only; executable SQL is unchanged. The prior minor is closed.

## Plan and architecture conformance

- The new timestamped migration is forward-only. No applied migration was edited.
- The migration drops the four exact s62 triggers, then the four trigger helpers and shared
  `rotate_public_content_revisions(uuid[])` helper. It retains
  `sites.public_content_revision`, its UUID default, `NOT NULL` contract and web-role denials.
- The revised revision contract proves the column's compatibility/privacy contract, complete
  trigger/function retirement, no parent-site mutation from content insert/update/delete, and
  continued `sites.updated_at` movement for an ordinary metadata update.
- The site-delete regression uses two PostgreSQL clients and an observed
  `pg_stat_activity`/blocking-PID barrier. It exercises the product-shaped parent delete against
  the draft RPC's child-row lock rather than relying on sleeps.
- The replay runner requires the retirement migration and reapplies s62 followed by the retirement
  twice, proving the final schema and retry convergence.
- ADR 064 and the published-snapshot architecture record match the implemented compatibility
  boundary. No runtime, authorization, RLS, route or public-snapshot behavior was added.

## Verification

- Fresh PostgreSQL 17 replay:
  `RCF_POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/run-db-invariants.mjs`
  passed all 16 named database suites: 114 passed, one intentionally skipped.
- Mutation proof in an owned temporary clone: the runner was changed by one line to reapply the old
  s62 revision migration after the retirement. Two suites went red with four failed tests:
  the deterministic overlap reproduced `40P01`, and the revision suite rejected the restored
  triggers/functions, old comment and parent-row mutation. The mutation was reversed and
  `git diff --exit-code` proved the temporary clone clean.
- `git diff --check origin/main...HEAD` passed.
- Follow-up inspection confirmed the finding repair changes only the migration tombstone and the
  separately verified default-build evidence in research. No executable SQL changed, so the
  passing database replay and mutation evidence above remain applicable without a redundant rerun.
- The corrected root-owned `/tmp/recopyfast-s65b-build.log` was inspected through its completed
  route table; the unchanged default build completed at this commit. The earlier dependency-symlink
  and webpack route-type notes are local setup history, not product defects.

## Not verified in this review

- No production/provider/database state was read and no migration was applied outside disposable
  PostgreSQL 17. Any out-of-repository consumer of revision rotation therefore remains unknowable;
  retaining the private column is the accepted compatibility boundary.
- The broad 484-suite Jest run, lint, type checks and audit were not repeated; the reviewer ran the
  database surface that can prove this story's lock, schema and privilege claims. Their reported
  broad results remain separate execution evidence.
- This database-only story has no browser gesture or third-party flow to exercise.

Max severity: none
Ship allowed: yes
