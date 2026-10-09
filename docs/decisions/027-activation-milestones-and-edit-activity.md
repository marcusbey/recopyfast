# ADR 027 — Activation uses write-once milestones plus an immutable edit-activity ledger

- Status: proposed — requires the reopened s03 human checkpoint
- Date: 2026-09-12
- Scope: proposed `s03a-activation-evidence` and `s03b-activation-funnel-surface`
- Supersedes ADR 007 only on writer topology and the ongoing-activity contract. ADR 007's
  `account_milestones` shape, first-write-wins rule and Auth confirmation event remain.

## Context

ADR 007 chose one row per account with four first-occurrence timestamps and application helpers
for three source events. Preflight against current `main` found two category errors.

First, an application call made after site/edit/install persistence is not atomic with that event.
If the analytics write fails, the product action succeeds and its one-time milestone is gone
forever. First-write-wins prevents overwriting evidence; it does not guarantee evidence exists.

Second, four timestamps cannot answer ongoing questions already assigned to `s14` and `s15`:
recent edits across sites and monthly edits per client. Rejoining live `site_permissions` to old
`staging_history` reattributes history when admins change and makes each consumer invent the same
account mapping again.

Current planning also supplies the missing foundations: `s26` makes one creator/owner permission
row authoritative and immutable, while `s24` makes a staged content update and its history row one
transaction. Those are the database events activation evidence must follow.

## Decision

1. `account_milestones` remains one row per account and the only source for the four funnel
   first-occurrence timestamps. A table trigger preserves the first non-null value.
2. `account_edit_activity` is a separate append-only relation, one row per accepted
   `staging_history` event, snapshotting the `s26` marked owner, site, element, validated
   `actor_kind`/`actor_user_id` and actor label. `s24` persists that identity from its authorized
   actor contract: `account` and `edit-session` are account principals; `staging` and
   `device-grant` are non-account principals; legacy `unknown` has no boolean classification and
   is excluded from both sides of the share. A nullable `staging_access_id` or email is never the classifier.
   `s14`/`s15` read it; they never
   rejoin current permissions or `user_activity_logs`.
3. Evidence is captured by pinned, locked-down database triggers inside the source transaction:
   `auth.users.email_confirmed_at`, the marked-owner permission created by `s26`,
   `sites.live_at`, and the `staging_history` row committed by `s24`. Missing authoritative owner
   is an integrity error that aborts the source transaction.
4. Every milestone row stores immutable `account_created_at`, including unconfirmed accounts.
   Date-range cohorts use that field rather than nullable `account_confirmed_at`. Accounts created
   after the cutoff are inserted explicitly with `unmeasurable=false`. Legacy accounts are marked
   unmeasurable using one fixed cutoff, but independently evidenced
   step timestamps and edit rows are backfilled. They count in funnel reach/drop-off and are
   excluded only from time-to-first-edit percentiles.
5. The global funnel is operator-only. One server predicate evaluates `ADMIN_EMAILS` and
   server-managed app metadata; the browser receives only a boolean capability. After that check,
   the route may use a read-only service client for global milestone/activity data. No service
   write or client-side allowlist is introduced.

## Consequences

The capture story now depends on `s24` and `s26`, so it is no longer an independent early lane.
That ordering is the cost of truthful attribution and atomic evidence. The surface becomes a
separate story with no migration, keeping UI/read-model review independent from trigger/RLS
review. Existing ADR 007 remains the historical record of the first design; implementation waits
for this proposal and the split story ids to be validated in `docs/stories.md`.
