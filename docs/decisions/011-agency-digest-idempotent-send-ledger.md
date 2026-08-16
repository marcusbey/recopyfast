# ADR 011 — Agency digest: a story-scoped, reclaimable idempotency ledger

## Status

Accepted — travels with `feature/s15-agency-digest`.

## Context

`s15-agency-digest` must send at most one monthly digest per agency account per period, even
though Vercel cron retries on timeout/5xx and the cron platform gives no delivery guarantee of
its own. `docs/research/s15-agency-digest.md` names the trap directly: *"record what was sent
before sending, not after"*, and points at `billing_events`
(`supabase/migrations/20260731003000_missing_tables_billing_credits.sql:19-45`) as the closest
precedent — an insert-first row with a `UNIQUE (stripe_event_id)` constraint that a duplicate
webhook delivery fails against.

Two things `billing_events` does not have to solve, that this story does:

1. **Retry after a genuine failure must still be possible.** The story's own criterion is explicit:
   *"Send failures are logged with account and period, and are retryable without duplicating
   successful sends."* `billing_events`' constraint is keyed on Stripe's own event id — a retried
   webhook carries the *same* id, so the same row is hit again and its `processed` flag is read
   before deciding what to do. This story's key is `(account_id, period)`, chosen by us, and two
   different things can produce a row with that key: a genuine duplicate cron invocation (must be
   rejected) and a legitimate retry of a *failed* attempt (must be allowed through). A plain
   insert-and-reject-on-conflict constraint cannot tell these apart — it rejects both.
2. **No generic "scheduled job dedupe" table exists anywhere in this codebase**, and no other story
   currently needs one. `docs/research/s15-agency-digest.md`'s open questions flag this by name.

There is also no existing table anywhere for a digest-only unsubscribe preference — greenfield,
confirmed by grep across every migration.

## Decision

**Two new tables, scoped to this story alone, not shared or generalized:**

- `agency_digest_sends(account_id, period_key, status, edit_count, error, sent_at, created_at)`,
  `UNIQUE (account_id, period_key)`.
- `digest_email_preferences(account_id, digest_unsubscribed_at, unsubscribe_token, created_at,
  updated_at)`, one row per account.

Both follow `billing_events`' exact RLS shape: `ENABLE ROW LEVEL SECURITY`, a `SELECT` policy
scoped to `auth.uid() = account_id` for the owner, and a permissive `FOR ALL TO service_role`
policy for the cron job and the unsubscribe endpoint.

**The send ledger uses claim-then-update, not insert-then-reject:**

```sql
INSERT INTO agency_digest_sends (account_id, period_key, status, edit_count)
VALUES ($1, $2, 'pending', $3)
ON CONFLICT (account_id, period_key)
  DO UPDATE SET updated_at = now()
  WHERE agency_digest_sends.status != 'sent'
RETURNING id;
```

Zero rows returned ⇒ this account+period already succeeded ⇒ skip, no send attempted. A row
returned ⇒ this call now owns the attempt (whether it is the first try or a retry of a prior
failure) ⇒ call `sendAgencyDigestEmail`, then `UPDATE ... SET status = 'sent' | 'failed', error =
...` on that same row. The claim happens *before* `send()` is called, honoring the research's
"before sending, not after" rule, while the `WHERE status != 'sent'` clause is what makes a failed
attempt reclaimable instead of permanently stuck.

## Rejected alternatives

1. **Reuse `billing_events` directly** (add an `event_type = 'agency_digest'` row with `data`
   carrying account/period). Rejected: the table's one uniqueness axis is `stripe_event_id`, which
   has no meaning here, and overloading it would require a second, informal uniqueness convention
   the column was never built to express — precisely the kind of drift `docs/architecture.md`'s
   comment style exists to prevent.
2. **Copy `billing_events`' plain insert-and-reject-on-conflict mechanism verbatim.** Rejected: it
   satisfies "no duplicate sends" but fails "retryable after a genuine failure" — a `resend.emails.send`
   timeout on day one would permanently and silently exclude that account from every future digest
   for that period, with no way to recover except a manual database edit. That is worse than the
   problem the idempotency criterion exists to prevent.
3. **Build a generic, shared `scheduled_job_dedupe` or `notification_preferences` table now**,
   anticipating that other cron jobs or future email preferences will want one. Rejected as
   premature generalization: no other story in the current backlog needs either shape today, and
   guessing the shape ahead of a second real caller risks an abstraction the next story has to work
   around rather than one it can reuse. `docs/research/s15-agency-digest.md` reaches the same
   conclusion independently ("A new table scoped to this story is the minimal correct answer").

## Consequences

- This ledger and preference table belong to `s15` alone. If a later story needs the same
  claim-then-update dedupe shape (another monthly/periodic job), generalize it then, from two real
  examples, not now from a guess.
- The unsubscribe token is a single long-lived value per account, not rotated per send. A leaked
  token lets someone unsubscribe an account from digests early — not a defacement, not a data
  disclosure. This is why the token does not need the CSPRNG-plus-hash treatment
  `editor-handoffs`/`staging_access` use for actual write-capable grants; a plain unique random
  token is proportionate here.
- Both tables are candidates for later reuse by a dashboard "digest history" view, but nothing in
  `s15`'s acceptance criteria requires one, and none is built here.
