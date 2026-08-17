# Review — Story s16-webhook-config

> Fresh-context review by the `reviewer` subagent.
> Diff reviewed: `git diff main...feature/s16-webhook-config` (`7469dbe`).

## Tests
- [x] Run by the reviewer. `npx jest --ci` **exit 0 — 150 suites passed / 1 skipped; 2068
      passed, 36 skipped, 2104 total.** lint 0 errors / 44 warnings (all untouched files),
      type-check clean, prettier clean, `npm run build` exit 0 with `public/embed/` unchanged
      after `prebuild`.
- [x] **This worktree *had* `.env`, `.env.local` and `.env.production`**, copied in at creation —
      so the four env-dependent suites genuinely passed rather than being waved away.
      **The worktrees are not uniform on this**, which corrects the generalisation drawn from the
      other reviews.
- [x] **Bite proven by neutralization — 16 mutations, 16 bit, 0 survivors.** Delivery-time SSRF
      recheck stubbed (3 red) · only first resolved address checked (1) · IPv4-mapped unwrap
      removed (1) · DNS failure fails open (1) · coalescing throttle → debounce (1) ·
      `getWebhooks` re-exposes secret (2) · `CRON_SECRET` gate removed (3) · publish stops
      recording (2) · PUT allowlist → spread-through (1) · config-time SSRF removed from POST (2)
      · rate limit bypassed on `/webhooks/test` (1) · `showClose` ignored (2) · backoff removed
      (2) · default-window copy removed (1) · show-once dialog never opens (1) · all rows render
      `delivered` (1). Restored after each; `git diff --exit-code` clean.

## The SSRF core — attacked, not read. It holds.
Two probe suites, 39 + 28 cases, deleted after running. All four required properties present:
two-point validation (config `route.ts:147`/`:263`, delivery `manager.ts:415` and `:746`, nothing
cached across the gap); **every** resolved address checked (`webhook-url-safety.ts:197` — a
second A record of `169.254.169.254` and an AAAA of `::ffff:10.0.0.7` both refused); IPv4-mapped
unwrapped before `range()`; fails closed on DNS rejection **and** empty result.

Also refused: decimal `2130706433`, hex `0x7f000001`, octal `017700000001`, `127.1`, CGNAT
`100.64.0.1`, 6to4, NAT64, broadcast, multicast, `file:` / `ftp:` / `gopher:`. The module uses an
**allowlist** (`range() === "unicast"`) rather than a denylist, which is why exotic ranges refuse
for free.

**Host confusion and IDNA — no bypass.** The reviewer had not probed these on its first pass and
went back to close it: `http://expected.com@169.254.169.254/`, `user:pass@127.0.0.1`,
`#@`/`?@`/`a@b@` variants, `127.0.0.1\@example.com`, `127.0.0.1.` — every case whose real connect
target is internal is refused. Circled digits `①②⑦.⓪.⓪.①` → `127.0.0.1` refused; ideographic
full stop `127。0。0。1` refused; `①②⑧.⓪.⓪.①` → `128.0.0.1` correctly allowed.

**A config-time-only check would have been critical. That is not what shipped.**

## Findings

### MAJOR 1 — one failing delivery auto-disables the webhook, and the panel then goes empty
`MAX_DELIVERY_ATTEMPTS = 5` (`manager.ts:54`) and the `max_failures: 5` written at creation
(`:149`) are the same number, and `handleWebhookFailure` runs on **every failed attempt**
(`:536`, `:620`) rather than once per event. Attempts 1→5 of a **single** delivery drive
`failure_count` 1→5, and on attempt 5 — the same tick `resolveRetryState` returns
`status: "failed"` — the webhook is set `is_active: false`.

`getWebhooks` filters `.eq("is_active", true)` (`:211`), so `GET /api/webhooks` returns `[]` and
the panel falls to "No webhook configured for this site." **The `failed` row that AC 3 requires be
"marked failed and visible as such" is unreachable** — along with the URL, the batch window and
the entire delivery history (AC 1). No signal that it was disabled, and no way back: `PUT`
accepts `is_active` but the UI never surfaces the id.

Proven by a probe driving the real `sweepDueDispatches` plus four `sweepDueRetries` ticks; the
`webhooks` update stream ends `{failure_count: 4}`, `{is_active: false, failure_count: 5}` at
exactly the tick the delivery row becomes `{attempt_number: 5, status: "failed"}`.

**Introduced by this diff.** On `main` the `setTimeout` retry never fired, so `failure_count`
advanced once per *event* and five separate failing events were needed. Making the retry engine
actually work is what makes this reachable. The plan foresaw the collision and said the two
"remain distinct concepts"; `manager.ts:630-638` repeats that claim in a comment while the code
makes them coincide.

### Minors
- **A — unauthenticated `POST /api/webhooks` resolves an arbitrary hostname and echoes the
  result.** `assertSafeWebhookUrl` runs at `route.ts:147-152`, **before** `auth.getUser()` at
  `:154-160`. With no session: `400 {"error":"jenkins.internal.corp resolves to 10.11.12.13, a
  private address…"}` with `dns.lookup` called once. `PUT` does it correctly (`:217-223` before
  `:262-270`) — the two verbs in one file disagree. Bounded by a 10/min/IP fail-closed limiter,
  and on Vercel's public resolver the leak is close to what public DNS gives anyone — **but it
  becomes major the day this sits behind a split-horizon or VPC resolver.** `dns.promises.lookup`
  also has no timeout, so the pre-auth path can be made to hang. `route.test.ts` has an
  unauthenticated case for GET, PUT and DELETE but **not POST**, which is why it went unnoticed.
- **B — `status: "pending"` is unreachable but rendered and tested.** Nothing in `src/` writes it;
  `manager.ts` writes only `delivered`/`retrying`/`failed`. The panel renders it
  (`WebhooksPanel.tsx:112`, `:450`) and the test asserts it against a hand-made fixture — a test
  passing on a state the system cannot produce. For the whole coalescing window plus up to five
  minutes of cron latency, the owner sees nothing indicating an edit is queued.
- **C — every save failure is labelled an address problem.** `saveError` renders under the URL
  field with the fixed title "This address can't be used", but it is set for any non-ok save —
  500, 403, dropped connection. Inverts the design's explicit point that a config-time refusal
  must read differently from a generic error.
- **D — `sweepDueDispatches` is unbounded** (no `.limit()`, unlike `sweepDueRetries`) and delivers
  serially with a 30s per-request ceiling; enough due windows on one tick and the invocation hits
  Vercel's execution ceiling mid-loop. Separately, a webhook auto-disabled with a window still
  open keeps `pending_dispatch_at` set forever — the sweep filters `is_active = true`.
- **E — `triggerEvent` remains a second, un-coalesced dispatch path**, still zero callers, still
  fanning out `deliverWebhook` directly. Not drift (the plan never asked for its removal) but a
  second dispatch path beside the real one is how the next agent wires the wrong one.
- **F — the new `Select` primitive drifts from `Input`.** `select.tsx:32` uses `bg-transparent`
  where `input.tsx:18` uses `bg-card`, and omits `focus-visible:border-ring` /
  `focus-visible:ring-offset-background`. Inside a `Card` they render identically so **this
  story's form is fine** — but `s05`, `s10` and `s14c` inherit it on other surfaces.
  `SelectContent`/`SelectItem` match `dropdown-menu.tsx` correctly.
- **G — plan drift, both directions, all small.** Added and justified: a deliveries route + test
  (AC 1 has no other way to load history), `webhookDeliveryStatuses` in `status-badge.tsx`, a
  dispatch-schema test. Migration timestamp differs from the plan's (immaterial). `PUT` has no
  rate limit though it triggers a DNS lookup. `WebhooksPanel.tsx:177-178` reads only `data[0]`
  while `POST` allows unlimited webhooks per site — a second one is invisible.

### Re-encoding checked, per the `s05` lesson — and it clears
`assertSafeWebhookUrl` returns `url.toString()` and the routes persist **that**, not what the
user typed. Mutations observed are all WHATWG normalizations and all semantically equivalent:
trailing `/` added, space → `%20`, `héllo` → `h%C3%A9llo`, IDN → punycode, host lowercased,
`:443` stripped. **The cases that would corrupt did not:** `?sig=a+b&x=a%2Bb` preserved exactly,
`/a%2Fb/c` preserved (no double-decode), `//double//slash` preserved, truncated `hook%2`
preserved rather than mangled. Unlike `s05`, nothing rewrites or truncates.

One sub-point worth the owner's eye: credentials survive round-trip
(`https://user:s3cr3t@example.com/hook` stored verbatim) and `url` is in `WEBHOOK_LIST_COLUMNS`,
so an embedded basic-auth secret is re-served on every dashboard load. The story went to real
lengths never to re-serve the `secret` column; this is the same class of value treated
differently. Small blast radius — the owner's own credential, shown to edit/admin holders.

## Other verification points — all confirmed
Automatic dispatch is genuinely wired (`staging/publish/route.ts:148`, inside `after()`, only when
`publishedRows.length > 0`, sole caller) · the retry engine is genuinely replaced, not tidied (no
`setTimeout` survives outside comments; cron `*/5 * * * *` in `vercel.json`) · `after()` is not
leaned on for backoff or coalescing, and the test proves deferral properly by spying `after`
without invoking the callback · the coalescing default is stated in the UI with an honest note
that the 5-minute cron is a floor · the secret is not re-served (column allowlist plus a
belt-and-braces delete) · no Stripe entanglement · no new tables, no zod · **`Select` is a genuine
addition, not a hallucination** — `docs/design-system.md` records it as gap 6.

## Not verified
No real outbound delivery — every `fetch` is mocked, and the HMAC has never been validated by a
real receiver. No real DNS and no real rebinding; the residual TOCTOU window the module itself
documents (`webhook-url-safety.ts:19-26`) is untestable by construction and remains open. No cron
run — and **whether Vercel accepts `*/5 * * * *` on this account's tier is unverified** (Hobby
caps at 2 jobs, daily only; there are now exactly 2 entries), exactly as ADR 010 flagged. No
database: the migration was never applied, so the `status` CHECK, both partial indexes, the
`NOT NULL DEFAULT 30` over existing rows and the RLS inheritance claim are asserted by grepping
SQL text. No browser. **Concurrency untested** — ADR 010's idempotency rests on each sweep
clearing its trigger "as part of the same operation that fires delivery", but
`sweepDueDispatches` clears in a `finally` *after* `deliverWebhook` returns (`manager.ts:362-377`)
— two round trips, so an overlapping tick can deliver the same coalesced payload twice.

**Human gestures:** point a webhook at webhook.site, publish a staging change, verify the
signature; point one at a 500 and watch it through all five attempts — the panel should fall to
"No webhook configured for this site" at attempt 5, which is MAJOR 1's user-visible half;
`npx supabase db reset`; check the Vercel plan tier accepts the cron.

## Addendum, 2026-08-17 — this migration would ABORT on production as it stands

Found by probing the live database, not by re-reading the diff. **`webhooks` and
`webhook_deliveries` do not exist in production.** They were to be created by
`20260731004000_missing_tables_integrations`, which aborted in full and is marked applied, so it
will never re-run.

`20260817003000_webhook_dispatch_and_secrets.sql` contains **zero `CREATE TABLE` statements** and
its first statement is `ALTER TABLE webhooks ADD COLUMN …`. Against production that is an immediate
`42P01`. Supabase wraps each migration in a transaction, so the whole file would roll back — **and
the ledger would record it as applied.** The feature would be silently dead, permanently, and this
story would reproduce the exact scar that caused the seventeen absent tables in the first place.

**This is not a review miss.** All three reviews judged the diff against `main`, where the migration
is valid SQL; the absence is environmental and invisible from inside the branch. It is the same
class as `s14a`'s `site_editors` dependency.

**Blocking constraint on merge:** `20260818000000_repair_aborted_migrations` must be applied to
production **before** this migration runs. That repair creates `webhooks` and `webhook_deliveries`
with the shape `20260731004000` intended, at which point this migration's `ALTER`s land correctly.
Do not merge and deploy `s16` ahead of it.

The verdict below stands as issued — the code is sound and the review's findings are unaffected.

## Verdict
Max severity: major
Ship allowed: yes
