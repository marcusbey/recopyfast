# ADR 060 — Daily blog generation is a durable claim completed with its draft

- Status: accepted
- Date: 2026-10-10
- Scope: review fix for story `s89-blog-drafts-only`
- Supersedes: ADR 057 §2's pre-read plus `blog_posts.generated_on` unique-key concurrency mechanism
- Preserves: every other decision in ADR 057, including draft-only generation and the two narrowly
  authorized service-role principals

## Context

ADR 057 made one `blog_posts` row per UTC day a database fact, but it did not make one provider
call per UTC day a fact. Two cron deliveries can both read "no post", both spend an OpenAI call,
then race at the unique `blog_posts.generated_on` index. The loser returns the winning row, so the
database looks correct while the provider was called twice. The independent s89 review reproduced
that exact overlap: two generation calls, one row, and `created: true` / `created: false` results.

A placeholder `blog_posts` row is not acceptable because an interrupted request would leave a row
that looks like a draft but has no generated content. A lease with automatic expiry is also unsafe:
OpenAI has no idempotency key for this request, so a slow or orphaned request may still complete and
charge after another isolate steals the lease.

## Decision

1. **The UTC day is claimed before OpenAI is called.** A separate non-tenant
   `blog_generation_claims` table has one row per `generated_on` day. Its states are `pending`,
   `succeeded`, and `failed`; the row carries an opaque UUID owner token, the successful `post_id`,
   and creation/update/completion timestamps. The acquisition RPC serializes the day in Postgres.
   Only the caller whose token acquired a new `pending` row may generate.
2. **Followers never generate.** A caller that finds `succeeded` returns that post with
   `created: false`. A caller that finds `pending` polls the service-role-only claim for a bounded
   interval and returns the same finalized post. A `failed` claim or a pending claim that does not
   finish inside the bound returns a generic retryable cron error. Neither outcome calls OpenAI.
3. **The draft and successful claim complete in one database transaction.** The finalization RPC
   locks the claim row, verifies the opaque owner token and `pending` state, inserts the
   field-by-field draft, and changes the claim to `succeeded` with its `post_id`. The existing slug
   policy remains: retry once with `-YYYY-MM-DD` after a collision. If any part fails, neither the
   draft nor the success transition commits. The caller then marks its still-owned pending claim
   `failed`; no draft is left behind.
4. **Existing daily drafts win.** Acquisition checks `blog_posts.generated_on` while it owns the
   day's database lock. A row created before this ledger existed is recorded as the successful
   claim and returned; it never triggers a replacement provider call.
5. **Claims are never stolen automatically.** There is no expiry, lease takeover, or failed-claim
   retry in request code. A slow/crashed provider request may still be billable, so only an operator
   may recover a pending or failed day after checking the provider and `blog_posts`. The recovery
   procedure is in `docs/operations/blog.md`.
6. **The ledger and its RPCs are service-role only.** RLS is enabled. `PUBLIC`, `anon`, and
   `authenticated` receive no table or function privilege; the cron reaches them only after the
   existing `CRON_SECRET` check. Claims never appear in blog API responses or public reads.

## Options considered

- **Keep the unique post key and accept the losing provider call.** Rejected: it fails the story's
  explicit concurrent duplicate requirement and spends money for discarded output.
- **Use a Redis lock or an expiring database lease.** Rejected: expiry permits takeover while a
  slow provider request is still running, recreating the duplicate charge window. Redis also cannot
  atomically commit the Postgres draft with the lock's success state.
- **Insert a placeholder draft before generation.** Rejected: a crash leaves incomplete content in
  the product table and makes a claim visible through admin draft tooling.
- **Retry failed or old claims automatically.** Rejected: a failed response does not prove the
  provider did no work. Recovery is an explicit operator decision.

## Consequences

- Deploy both s89 migrations before the application code. The second migration creates the claim
  table and RPCs; the first still supplies `blog_posts.generated_on` and its defensive unique key.
- A crashed owner can stop that day's automatic generation until an operator clears the claim. This
  is intentional fail-closed behavior: availability is cheaper than an unknown duplicate spend.
- On-demand admin generation remains unclaimed and unchanged; it is deliberately allowed any number
  of times per day.
