# Free tools — operations

> s96 ([ADR 062](../decisions/062-free-tool-reports-are-service-role-reads-under-the-nonce-csp.md)).
> The public `/tools` pages, `POST /api/tools/scan`, the reports at `/tools/<slug>/r/<id>` and the
> `tool_reports` table.

## What a scan does

1. Guards (in order): kill switch → same-origin guard → client key → burst limiter → body and URL
   checks → denylist → 24 h cache → daily, /48, global and per-target limiters.
2. Fetches robots.txt (obeyed for `RecopyFastToolsBot`, else `*`), the homepage, up to two sitemap
   files and up to nine pages: at most **24 requests**, **8 s** each, **20 s** for the scan, **2 MB**
   of decompressed HTML per page. Every hop goes through `src/lib/tools/fetch/safe-fetch.ts`
   (public unicast addresses only — for IPv6, global unicast `2000::/3` minus the NAT64 local-use,
   documentation and benchmarking ranges — ports 80/443, no proxy, no cookies).
3. Runs the tool's lens and stores one row in `tool_reports` (expires after 30 days at most; the
   5,000-row trim can remove older rows sooner at full volume, so the copy says "up to 30 days").

User agent: `RecopyFastToolsBot/1.0 (+https://www.recopyfa.st/tools)`.

## Limits

| Bucket (Redis, fail closed) | Limit | Key |
|---|---|---|
| `tools/scan:burst` | 5 / minute | IPv4 address, or IPv6 /64 |
| `tools/scan:daily` | 5 / day (cache misses only) | IPv4 address, or IPv6 /64 |
| `tools/scan:daily48` | 20 / day (cache misses only) | IPv6 /48 |
| `tools/scan:global` | 500 / day (cache misses only) | everyone |
| `tools/scan:target` | 20 / hour (cache misses only) | registrable domain (eTLD+1, `tldts` with private suffixes) of the submitted host; charged again for the final host after redirects when its registrable domain differs |

A request refused by a later bucket has spent the earlier ones (strict on purpose). A failed scan
has spent its daily allowance. A cache hit spends only the burst bucket. Daily windows reset at
00:00 UTC.

## Switches (Vercel environment variables; redeploy after changing)

| Variable | Effect |
|---|---|
| `TOOLS_SCAN_DISABLED=1` | Kill switch: every scan answers 503 before anything runs. Reports stay readable. |
| `TOOLS_SCAN_GLOBAL_DAILY_CAP=<n>` | Replaces the 500/day global cap (launch day). Anything but a positive integer means 500. |
| `TOOLS_SCAN_DENYLIST=a.com,b.org` | Hosts never scanned, subdomains included (422 `denylisted`). The operator override behind robots.txt. |

**The global cap was hit** — the scan route logs `[tools/scan] global daily scan cap reached` at
error level. Either raise `TOOLS_SCAN_GLOBAL_DAILY_CAP` for the day, or, if it keeps happening,
build Turnstile (s96b).

**A site owner asks not to be scanned** — point them at "About our scanner" on `/tools`
(robots.txt: `User-agent: RecopyFastToolsBot` / `Disallow: /`). If they cannot edit robots.txt, add
their host to `TOOLS_SCAN_DENYLIST` and redeploy. Existing reports expire within 30 days; to remove
them now, delete by URL (read-only first):

```sql
SELECT id, created_at FROM public.tool_reports WHERE url LIKE 'https://example.com/%' OR url LIKE 'http://example.com/%';
-- then, with the owner's agreement:
DELETE FROM public.tool_reports WHERE url LIKE 'https://example.com/%' OR url LIKE 'http://example.com/%';
```

## Storage budget

At most 5,000 rows of at most 16 KB (`report::text`; the app keeps compact JSON ≤ 12 KB): ≤ 80 MB
of Supabase Free's 500 MB, where going over makes the **whole database read-only**. The daily cron
`GET /api/cron/tool-reports-cleanup` (03:15 UTC) runs `prune_tool_reports(5000)`: expired rows
first, then the oldest live rows past the ceiling.

```sql
-- Table size and row count
SELECT pg_size_pretty(pg_total_relation_size('public.tool_reports')) AS table_size,
       (SELECT count(*) FROM public.tool_reports) AS rows,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;

-- Largest reports
SELECT id, tool, octet_length(report::text) AS bytes
FROM public.tool_reports ORDER BY bytes DESC LIMIT 10;
```

## Usage (read-only)

There is no visitor analytics (launch kit §12). Scans are the rows:

```sql
-- Scans stored per tool per day (cache hits are not rows)
SELECT tool, date_trunc('day', created_at) AS day, count(*) AS scans
FROM public.tool_reports
GROUP BY 1, 2 ORDER BY 2 DESC, 1;

-- Most scanned hosts, last 7 days
SELECT split_part(split_part(url, '://', 2), '/', 1) AS host, count(*) AS scans
FROM public.tool_reports
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- Verdicts, last 7 days
SELECT tool, report->'summary'->>'verdict' AS verdict, count(*)
FROM public.tool_reports
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```

Scan outcomes that store nothing (refusals, failures) appear only in the function logs:
`[tools/scan] { tool, host, outcome, durationMs }`. The client address and the full URL are never
logged.

## Privileges (should never change)

```sql
SELECT has_table_privilege('anon', 'public.tool_reports', 'SELECT') AS anon_select,
       has_table_privilege('authenticated', 'public.tool_reports', 'SELECT') AS auth_select,
       has_function_privilege('anon', 'public.prune_tool_reports(integer)', 'EXECUTE') AS anon_prune;
-- all three must be false
```
