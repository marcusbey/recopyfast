---
validated: no
proposed_split_from: s03-activation-funnel
---
# Plan — Proposed story s03a-activation-evidence

Branch after story validation: `feature/s03a-activation-evidence`
Research: `docs/research/s03-activation-funnel.md`
Design: none — this is a data-only story; `docs/designs/s03-activation-funnel.md` belongs to
proposed `s03b-activation-funnel-surface`.
Decision: proposed `docs/decisions/027-activation-milestones-and-edit-activity.md`

## Goal and dependencies

Persist the four first-occurrence funnel timestamps and every accepted edit from the database
transaction that owns the source event. Keep milestone truth and ongoing activity as separate,
purpose-built relations.

Dependencies: shipped `s01-trial-signup`, shipped `s02-install-verified`, proposed
`s26-owner-quota-integrity` (one immutable marked owner and atomic registration), and proposed
`s24-staging-write-integrity` (content + history commit together and persists validated actor
kind/user identity; transitively depends on `s34`).
Do not execute this plan until all four are on the branch base and this split exists in
`docs/stories.md`.

## Tasks

1. [ ] **Write DB-backed failing source-event invariants first.** In a fresh isolated database,
   prove the current schema has no milestone/activity relations. Specify fixtures for: confirmed
   email INSERT and UPDATE; marked-owner site registration; `sites.live_at` NULL→timestamp;
   account, edit-session, staging-grant and device-grant edits through `s24`'s atomic history path;
   duplicate source replay;
   missing/ambiguous owner; and two sites with different owners. Tests assert both the source row
   and its evidence row commit, or both roll back.

2. [ ] **Create the two relations and reproducible backfill in one forward migration.**
   `account_milestones`: `account_id` PK/FK, immutable `account_created_at timestamptz`, the four nullable `timestamptz` columns,
   `unmeasurable boolean not null default false`, `created_at`, `updated_at`.
   `account_edit_activity`:
   `id`, unique logical `staging_history_id` (stored without a cascading FK so deleting an element
   cannot rewrite historical attribution), immutable `account_id`, `site_id`, `content_element_id`,
   nullable `staging_access_id`, `actor_kind`
   (`account|edit-session|staging|device-grant|unknown`), nullable `actor_user_id`, `actor_label`,
   nullable `is_non_account`, `edited_at`, `created_at`.
   `account_id` cascades only when the account is deleted; site/element/access ids are immutable
   evidence values, not cascading references. Add indexes for `(account_id, edited_at)` and
   `(site_id, edited_at)`. RLS in the same migration: authenticated users SELECT only their own
   account rows; service role ALL; no authenticated writes.

   Use one fixed ISO cutoff authored in the migration, never runtime `now()`. Insert every older
   account with `unmeasurable=true`, storing `account_created_at=auth.users.created_at` and still
   backfilling each independently evidenced step: `auth.users.email_confirmed_at`; earliest marked-owner site `created_at`; earliest owned
   `sites.live_at`; earliest owned `staging_history.created_at`. Backfill activity from history
   against `s26`'s single marked owner. Legacy actor classification uses only explicit historical
   evidence; rows lacking an actor kind are marked `unknown` and excluded from the account versus
   non-account share rather than guessed from email or a nullable staging-access FK.
   Thus unmeasurable accounts contribute to step/drop-off counts but never percentiles. A fixture
   with partial legacy evidence proves only the evidenced columns are populated.

3. [ ] **Enforce first-write-wins at the table.** Add a `BEFORE UPDATE` trigger that restores each
   non-null milestone timestamp from `OLD` and preserves the original `account_created_at` and
   `unmeasurable` values. Replay every source
   event with a later time and assert the original survives. Concurrent first writers must settle
   on exactly one stored value without duplicate rows.

4. [ ] **Capture account cohort and confirmation atomically.** Add an `AFTER INSERT OR UPDATE OF email_confirmed_at`
   trigger on `auth.users`. Every INSERT records immutable `account_created_at=NEW.created_at` even
   when the account is unconfirmed and explicitly inserts `unmeasurable=false` for post-cutoff
   accounts; INSERT/UPDATE records `account_confirmed_at` only when non-null.
   Its `SECURITY DEFINER` body uses
   fully qualified objects, pins `search_path = pg_catalog, public, pg_temp`, and has effective
   EXECUTE revoked from `PUBLIC`, `anon`, and `authenticated` (service-role/owner only). OAuth
   insert and link-confirm update both write the exact Auth timestamp; an unconfirmed post-cutoff
   insert creates a cohort row with `unmeasurable=false`; replay does not move either value.

5. [ ] **Capture first registration from the authoritative owner event.** After `s26` makes site
   creation plus the marked owner permission atomic, an `AFTER INSERT` trigger on
   `site_permissions` for `granted_by IS NULL AND user_id IS NOT NULL` writes
   `first_site_registered_at` from that site's `created_at`. Missing site/account aborts the source
   transaction. A manager/admin row with `granted_by IS NOT NULL` writes nothing.

6. [ ] **Capture first verified install from the shipped state transition.** An `AFTER UPDATE OF
   live_at` trigger on `sites`, only for `OLD.live_at IS NULL AND NEW.live_at IS NOT NULL`, resolves
   the one `s26` marked owner and writes `first_verified_install_at = NEW.live_at` in the same
   transaction. Later liveness bumps and replayed reports write nothing. Missing/ambiguous owner
   fails closed and is covered by a DB invariant.

7. [ ] **Capture edit evidence and the first-edit milestone atomically.** First amend and validate
   the `s24` contract so its atomic RPC writes explicit `staging_history.actor_kind` and
   `actor_user_id` from the already-authorized `EditorAccess`; it must never infer identity from
   email or `staging_access_id`. After `s24` makes the content update and history insert one
   transaction, an `AFTER INSERT` trigger on
   `staging_history` joins its content element to the one marked owner, inserts exactly one
   `account_edit_activity` row, and writes `first_persisted_content_update_at` from
   `NEW.created_at`. `account` and `edit-session` snapshot `is_non_account=false`; `staging` and
   `device-grant` snapshot true; legacy `unknown` stores NULL and is excluded from both numerator
   and denominator. `staging_access_id` remains attribution detail, never the classifier.
   `actor_label`/`actor_user_id` are copied at event time. Tests cover all five kinds. A later owner/permission
   change cannot reattribute the row. Owner corruption aborts the source write rather than
   producing ownerless evidence.

8. [ ] **Lock down and prove every trigger body.** Add catalog assertions for exact function
   identity, `prosecdef`, pinned path, refused roles and allowed owner/service role. Extend the
   existing list-wide function-grant/search-path invariants rather than adding a weaker harness.
   Apply migrations only to a newly created local fixture database; never run `db push` or target
   production/shared Postgres during Execute.

9. [ ] **Publish the consumer contract.** Add hand-written types and a read-only
   `src/lib/analytics/account-activity.ts` query helper over `account_edit_activity`, with exact
   account/site/date filters and no fallback to `user_activity_logs` or live permission joins.
   `s14` and `s15` consume this helper/ledger; funnel timestamps come only from
   `account_milestones`.

## Interdicts and verification

- No application route writes a milestone after its source write; no best-effort timer/`after()`.
- No owner is selected from an unordered admin row; only the `s26` creator marker is valid.
- No applied migration edit, production DB call, new auth path, or activity-log reaggregation.
- Trigger bodies are pinned and schema-qualified; new relations ship RLS with creation.
- Run isolated migration replay, DB concurrency/RLS/function-grant tests, focused type tests, then
  lint, type-check, format, build and full Jest. Review must pass before Ship.

## Definition of Done

All four source events commit atomically with immutable evidence, duplicate events preserve the
first timestamp, legacy accounts are countable but excluded from durations, and ongoing edit rows
retain the owner/actor classification present when the edit occurred.
