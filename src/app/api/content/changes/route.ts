/**
 * GET /api/content/changes — what changed on the caller's sites (s70b).
 *
 * The Changes page's one read. The page it replaces waited on GET /api/sites
 * (~4 s: an exact count, every element id and two history queries per site,
 * for one number), then pulled every row of every site through the widget's
 * read and filtered them in the browser. This route returns the caller's sites
 * itself, with one RLS select, and 50 rows of `public.content_changes`, the
 * security-invoker view where the change state is derived once (ADR 054).
 * Filtering, counting and paging run in Postgres.
 *
 * Read-only and RLS-only. Everything below runs on the signed-in user's client
 * and the service role is never imported: the view runs as its caller, so a
 * member reads their own sites' rows and only an admin reads `changed_by`. The
 * explicit site filter is a second fence, not the first. No write path lives
 * here; reverts and publishes go through PUT /api/staging/content/<site> and
 * POST /api/staging/publish, which carry the plan gate and the audit row.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { escapeRegex } from "@/lib/content/search-pattern";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
/**
 * Beyond this an owner is not paging, something is crawling. "Show 50 more"
 * two hundred times is 10,000 rows; the view's CASE runs per row skipped.
 */
const MAX_OFFSET = 10_000;
const MAX_QUERY_LENGTH = 200;
const FAILURE = "Failed to load changes";

const STATES = ["changes", "pending", "published", "all"] as const;
type StateFilter = (typeof STATES)[number];
type ChangeState = "pending" | "published" | "original";

const ROW_COLUMNS =
  "id, site_id, element_id, page_path, selector, language, variant, element_type, original_content, published_content, staging_content, change_state, changed_at, changed_by, created_at";

interface ViewRow {
  id: string;
  site_id: string;
  element_id: string;
  page_path: string | null;
  selector: string | null;
  language: string;
  variant: string;
  element_type: string | null;
  original_content: string | null;
  published_content: string | null;
  staging_content: string | null;
  change_state: ChangeState;
  changed_at: string | null;
  changed_by: string | null;
  created_at: string;
}

interface Membership {
  permission: string;
  sites:
    | { id: string; name: string | null; domain: string }
    | Array<{ id: string; name: string | null; domain: string }>
    | null;
}

/** The three filters every content read here shares. */
interface FilterChain {
  eq(column: string, value: string): FilterChain;
  in(column: string, values: readonly string[]): FilterChain;
  filter(column: string, operator: string, value: string): FilterChain;
}

interface ChangesQuery {
  site: string | null;
  state: StateFilter;
  /** `q` as a regex matching only its own text; null when there is no search. */
  pattern: string | null;
  offset: number;
}

type Parsed = { ok: true; value: ChangesQuery } | { ok: false; error: string };

function parseQuery(params: URLSearchParams): Parsed {
  const rawState = params.get("state") ?? "changes";
  if (!(STATES as readonly string[]).includes(rawState)) {
    return { ok: false, error: "Invalid state" };
  }

  const rawOffset = params.get("offset") ?? "0";
  // Digits only: "-1", "1.5", "1e3" and "abc" are all refused, never coerced.
  if (!/^\d{1,5}$/.test(rawOffset) || Number(rawOffset) > MAX_OFFSET) {
    return { ok: false, error: "Invalid offset" };
  }

  const q = (params.get("q") ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: "Search is too long" };
  }
  return {
    ok: true,
    value: {
      site: params.get("site"),
      state: rawState as StateFilter,
      // Any text is a valid search, `*` included (search-pattern.ts: the
      // 400 it once got was shown as a page failure).
      pattern: q ? escapeRegex(q) : null,
      offset: Number(rawOffset),
    },
  };
}

/**
 * `staging_history.user_email` can hold a user id or an access kind
 * (`access.email || access.userId || access.kind`, staging PUT): only an
 * address is a "who".
 */
function emailOrNull(value: string | null): string | null {
  return value && value.includes("@") ? value : null;
}

function toRow(row: ViewRow) {
  return {
    id: row.id,
    siteId: row.site_id,
    elementId: row.element_id,
    pagePath: row.page_path,
    elementType: row.element_type,
    selector: row.selector,
    language: row.language,
    variant: row.variant,
    original: row.original_content,
    // "Live now" is the original until the row is first published, as the
    // widget's read serves it (`published ?? original`).
    live: row.published_content ?? row.original_content,
    draft: row.staging_content,
    state: row.change_state,
    changedAt: row.changed_at,
    changedBy: emailOrNull(row.changed_by),
    createdAt: row.created_at,
  };
}

function failure(context: string, error: unknown): NextResponse {
  console.error(`content/changes: ${context}`, error);
  return NextResponse.json({ error: FAILURE }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    // Before getUser(), as every route here: the session check is a GoTrue
    // round trip, so a limiter behind it never sees the flood. Per IP and
    // fail-open: a signed-in, read-only list. A Redis blip must not blank the
    // owner's page, and an unmetered window costs bounded RLS reads of the
    // caller's own rows.
    const limited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "content/changes",
      identifierType: "ip",
      onStoreFailure: "allow",
    });
    if (limited) return limited;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { site, state, pattern, offset } = parsed.value;

    // The caller's sites, read here rather than from GET /api/sites (the
    // ~4 s route). Only safe columns of `sites` are named (ADR 033).
    const { data: memberships, error: membershipError } = await supabase
      .from("site_permissions")
      .select("permission, sites(id, name, domain)")
      .eq("user_id", user.id);
    if (membershipError) return failure("site read failed", membershipError);

    const sites = ((memberships ?? []) as Membership[])
      .flatMap((membership) => {
        const joined = Array.isArray(membership.sites)
          ? membership.sites[0]
          : membership.sites;
        return joined
          ? [
              {
                id: joined.id,
                name: joined.name || joined.domain,
                domain: joined.domain,
                permission: membership.permission,
              },
            ]
          : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    if (site !== null && !sites.some((candidate) => candidate.id === site)) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    if (sites.length === 0) {
      return NextResponse.json({
        sites,
        rows: [],
        total: 0,
        counts: { pending: 0, published: 0, original: 0 },
        nextOffset: null,
      });
    }

    const siteIds = sites.map((candidate) => candidate.id);
    // One filter set for the list and every count, so a count can never
    // describe a different list than the one on screen.
    //
    // Typed through `FilterChain` rather than a constrained generic: checking
    // PostgREST's builder against a structural constraint is "excessively
    // deep" for tsc. The three methods are the builder's own.
    const scoped = <T>(query: T): T => {
      const chain = query as unknown as FilterChain;
      const bySite = site
        ? chain.eq("site_id", site)
        : chain.in("site_id", siteIds);
      // The pattern (search-pattern.ts: every regex metacharacter escaped)
      // reaches PostgREST as `imatch`, never `.ilike()`, whose `*` PostgREST
      // turns into `%`. `.filter()` appends one `search_text=imatch.<value>`
      // query parameter, the value percent-encoded by URLSearchParams, and
      // PostgREST binds everything after `imatch.` as one literal. Never
      // through `.or()`: that takes a raw filter string, and request text
      // spliced into one is filter injection (the s27 page-path read refused
      // the same thing, see paged-elements.ts).
      return (pattern
        ? bySite.filter("search_text", "imatch", pattern)
        : bySite) as unknown as T;
    };

    let list = scoped(
      supabase.from("content_changes").select(ROW_COLUMNS, { count: "exact" }),
    );
    if (state === "changes") {
      list = list.in("change_state", ["pending", "published"]);
    } else if (state !== "all") {
      list = list.eq("change_state", state);
    }

    const countOf = (changeState: ChangeState) =>
      scoped(
        supabase
          .from("content_changes")
          .select("id", { count: "exact", head: true }),
      ).eq("change_state", changeState);

    const [listResult, pending, published, original] = await Promise.all([
      list
        .order("changed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      countOf("pending"),
      countOf("published"),
      countOf("original"),
    ]);

    if (listResult.error) return failure("list read failed", listResult.error);
    for (const count of [pending, published, original]) {
      if (count.error) return failure("count read failed", count.error);
    }

    const rows = ((listResult.data ?? []) as ViewRow[]).map(toRow);
    const total = listResult.count ?? rows.length;
    const reached = offset + rows.length;

    return NextResponse.json({
      sites,
      rows,
      total,
      counts: {
        pending: pending.count ?? 0,
        published: published.count ?? 0,
        original: original.count ?? 0,
      },
      nextOffset: rows.length > 0 && reached < total ? reached : null,
    });
  } catch (error) {
    return failure("unexpected error", error);
  }
}
