# ADR 062 — Free-tool reports are service-role reads by id, rendered under the nonce CSP

- Status: accepted
- Date: 2026-10-11
- Scope: story `s96-free-tools-platform` (and the tools s97–s101 that reuse it)
- Related: [ADR 002](./002-rls-tenant-boundary.md) (RLS is the tenant boundary),
  [ADR 046](./046-unauthenticated-published-copy-snapshot.md) (the other named unauthenticated
  exception), [ADR 059](./059-nonce-csp-on-the-app-surface.md) (the two CSPs)

## Context

s96 adds the first public, anonymous product surface that both **fetches URLs chosen by a
stranger** and **renders text scraped from those URLs to other strangers**:

- `POST /api/tools/scan` fetches up to 24 URLs per scan and stores a report;
- `/tools/<slug>/r/<id>` shows that report to anyone holding the link.

Three things in the existing conventions did not fit:

1. **Data access.** AGENTS.md allows the service role only behind an `authorize*` call, the cron
   bearer, a platform admin or a site admin. A report has no owner and no session. The obvious RLS
   answer — `SELECT … USING (true) TO anon` — lets anyone holding the public anon key run
   `GET /rest/v1/tool_reports?select=*` and **list every address anyone ever scanned**, staging
   hosts included. An unguessable id protects nothing once a listing exists.
2. **CSP.** The marketing surface runs `script-src 'self' 'unsafe-inline'` so prerendered pages
   hydrate (ADR 059). s79 moved the dashboard to the nonce policy precisely because it renders
   text scraped off customer pages. A report renders text scraped off *anyone's* page.
3. **Site-owner consent.** A scanner that reads other people's sites needs a standard opt-out.

## Decision

1. **`public.tool_reports` is service-role only.** RLS on, one policy `FOR ALL TO service_role`,
   enumerated revokes from PUBLIC, `anon` and `authenticated` (table, column and function
   privileges), and a migration postcondition that aborts the push if any web principal keeps one.
   Rows are immutable: the service role reads, inserts and deletes, and holds no UPDATE.
2. **The report page is a named unauthenticated exception**, like ADR 046's snapshot, and not a
   pattern to copy. It validates the id as a UUID before any read (a non-UUID never reaches
   Postgres), checks the slug is a scanning catalogue tool and equals the row's tool, reads **one row
   by id** through the service role with a fixed projection (`id, tool, report, created_at,
   expires_at`) and only while unexpired, and re-validates the stored JSON (`parseStoredReport`)
   before rendering. Anything off is a 404.
3. **The scan route reaches the service role only after its guards**: the operator kill switch,
   a stateless same-origin guard (JSON content type, `Sec-Fetch-Site`, `Origin`), an identifiable
   client, a fail-closed burst limiter before the body is read, then on a cache miss fail-closed
   daily, /48, global and per-target limiters. It writes one row per successful scan; a refused or
   failed scan writes nothing.
4. **Reports render under the nonce CSP, at exactly `/tools/<slug>/r/<id>`.**
   `NONCE_POLICY_PATH_PATTERNS` adds that one depth (optional trailing slash) and nothing wider: the
   hub and tool pages stay prerendered under the marketing policy, and deeper paths keep the static
   policy because they 404 through Next's static `/_not-found`. The report segment's layout awaits
   `connection()` and owns a per-request `not-found.tsx`. Every link into a report is a native `<a>`
   (the scan form uses `window.location.assign`), because the policy belongs to the document.
   Escaping (React text only, no `dangerouslySetInnerHTML` outside serialised JSON-LD) stays the
   first defence; the nonce is the second.
5. **The scanner honours robots.txt** for its product token `RecopyFastToolsBot`, else `*`
   (RFC 9309), on every hop including sitemaps; a 4xx robots.txt allows, an unreachable one refuses
   the scan with the real reason. The env denylist (`TOOLS_SCAN_DENYLIST`) is the operator's
   override. The user agent links to `/tools`, whose "About our scanner" says what is read, what
   is stored and how to opt out. No contact address is published until the support mailbox works.
6. **Storage is bounded**: 30-day expiry, at most 5,000 rows (≤ 80 MB on Supabase Free), compact
   report JSON ≤ 12 KB in the app and `report::text` ≤ 16 KB in the database. A daily cron
   (`/api/cron/tool-reports-cleanup`, bearer-gated) runs `prune_tool_reports`, one `SECURITY
   INVOKER` function only the service role may execute.

### Dependencies (licences)

- `parse5` ^7.3.0 — MIT. Already in the lockfile through `jsdom`; now direct. Builds a tree and
  nothing else (no script execution, no resource loading). Its tree construction is quadratic in
  nesting depth and in a tag's attribute count, so the extractor bounds depth (512), element count
  (100,000) and parse time (1.5 s per page, in 16 KB chunks) — see `extract-page.ts`.
- `wordlist-english` 1.2.1 — MIT, built from SCOWL. SCOWL's notice (Kevin Atkinson, permissive,
  "provided that the above copyright notice appears in all copies") ships with the package's
  `Copyright` file, which `next.config.ts` traces into the scan function with the word lists.

## Options considered

- **An anon SELECT policy keyed on an unguessable id.** Rejected: PostgREST lists the table to the
  public anon key; there is no RLS predicate meaning "only if you already know the id".
- **A `SECURITY DEFINER` RPC `get_tool_report(id)` granted to anon.** Rejected: it is the same
  exception with a wider surface (a PostgREST endpoint for every caller, no request-level
  limiter), and it would join `function-grants.test.ts`'s definer allowlist for no gain over a
  server-side read the page already does.
- **Keep reports under the marketing CSP.** Rejected: one escaping bug in the report components
  would run a stranger's inline script on our origin. The nonce costs CDN caching of reports only
  (one PK read per view).
- **Turnstile on the scan form.** Deferred (s96b): it needs `frame-src`/`script-src` for
  `challenges.cloudflare.com` on the marketing policy. Built only when the global cap is hit.
- **Opt-out by email only.** Rejected: the support mailbox is not working yet, and robots.txt is
  the standard every site owner already controls.

## Consequences

- `AGENTS.md` § Data access names this exception beside ADR 046's.
- `docs/architecture.md` lists the integration, the table and the extra nonce path.
- A later tool adds a catalogue entry and a registry line; it inherits this decision unchanged.
- A report link dies after 30 days, or sooner under a spike (the row ceiling); the 404 says so.
