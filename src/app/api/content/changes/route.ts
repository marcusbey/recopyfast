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
 *
 * One more RLS read, for pending rows only: the attributes their drafts stage
 * (`metadata.staging_attributes`), each with its live value. The view does
 * not carry metadata, by design (ADR 054: a widened view is a widened read
 * for every member), so the base table is read for those ids, as the history
 * route reads it, under the same content_elements policy the view already
 * applies. Only names and LIVE values leave, never a staged value: the live
 * href/alt is already on the customer's public page. The state is not derived
 * here; the view still decides what is pending. See useChangeActions.ts,
 * `discardAttributes`, for why Discard needs them (Devin review, PR #77).
 *
 * `?site=<id>&element=<element id>` narrows every read to one element's rows,
 * every language and variant. The page re-reads them after each write, and
 * Discard re-reads its row just before it writes (s70b fix pass, C1/M1):
 * the client never derives what a write left on the server.
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  CHANGES_MAX_OFFSET as MAX_OFFSET,
  CHANGES_PAGE_SIZE as PAGE_SIZE,
} from "@/lib/content/changes-paging";
import { escapeRegex } from "@/lib/content/search-pattern";
import { MAX_ELEMENT_ID_LENGTH } from "@/lib/security/discovered-text";
import { createClient } from "@/lib/supabase/server";

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

interface DraftAttribute {
  name: string;
  live: string | null;
}

interface MetadataRow {
  id: string;
  metadata: unknown;
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
  /** One element id of `site`: every language and variant row of it. */
  element: string | null;
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

  // `element` narrows the read to one element of one site: the rows a write
  // to that element could have touched (s70b fix pass, C1: Publish promotes
  // every language and variant row of an element_id, so the page re-reads
  // them all after any write). An element id is unique only within a site,
  // so it is refused without one; the site is still checked against the
  // caller's own below, like any other.
  const site = params.get("site");
  const element = params.get("element");
  if (
    element !== null &&
    (site === null ||
      element.length === 0 ||
      element.length > MAX_ELEMENT_ID_LENGTH)
  ) {
    return { ok: false, error: "Invalid element" };
  }
  return {
    ok: true,
    value: {
      site,
      element,
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

const objectOrEmpty = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Every key the draft stages, with the live value of that key (null when the
 * live metadata has no string there). The live metadata is the column minus
 * `staging_attributes`, as the save and publish RPCs read it.
 */
function draftAttributesOf(metadata: unknown): DraftAttribute[] {
  const live = objectOrEmpty(metadata);
  return Object.keys(objectOrEmpty(live.staging_attributes)).map((name) => ({
    name,
    live: typeof live[name] === "string" ? (live[name] as string) : null,
  }));
}

function toRow(row: ViewRow, draftAttributes: DraftAttribute[] | null) {
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
    draftAttributes,
    // False when the row has no published text of its own (a translation is
    // written without one: api/ai/translate), and `live` stands in the
    // original. Its draft cannot be discarded through the staging PUT: any
    // text it saves still differs from that NULL, so the row stays pending
    // (verification of 63d7ba2, minor 6). The page says so instead.
    hasLiveText: row.published_content !== null,
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
    const { site, element, state, pattern, offset } = parsed.value;

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
      const byElement = element ? bySite.eq("element_id", element) : bySite;
      // The pattern (search-pattern.ts: every regex metacharacter escaped)
      // reaches PostgREST as `imatch`, never `.ilike()`, whose `*` PostgREST
      // turns into `%`. `.filter()` appends one `search_text=imatch.<value>`
      // query parameter, the value percent-encoded by URLSearchParams, and
      // PostgREST binds everything after `imatch.` as one literal. Never
      // through `.or()`: that takes a raw filter string, and request text
      // spliced into one is filter injection (the s27 page-path read refused
      // the same thing, see paged-elements.ts).
      return (pattern
        ? byElement.filter("search_text", "imatch", pattern)
        : byElement) as unknown as T;
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

    const viewRows = (listResult.data ?? []) as ViewRow[];
    const pendingIds = viewRows
      .filter((row) => row.change_state === "pending")
      .map((row) => row.id);
    const attributesById = new Map<string, DraftAttribute[]>();
    if (pendingIds.length > 0) {
      // The site filter is the second fence here too (this file's header):
      // RLS is the first. Devin re-review N3: this read had the ids alone.
      const { data: metadataRows, error: metadataError } = await supabase
        .from("content_elements")
        .select("id, metadata")
        .in("id", pendingIds)
        .in("site_id", siteIds);
      if (metadataError) return failure("metadata read failed", metadataError);
      for (const row of (metadataRows ?? []) as MetadataRow[]) {
        attributesById.set(row.id, draftAttributesOf(row.metadata));
      }
    }

    // A pending row the metadata read did not return (deleted between the two
    // reads, or no longer readable) is null, "not known", which the page never
    // offers to discard. Tombstone (Devin re-review N2): it was `[]`, "stages
    // nothing", so Discard was offered and sent the text alone, which leaves a
    // staged link staged (the save RPC merges attribute patches).
    const rows = viewRows.map((row) =>
      toRow(
        row,
        row.change_state === "pending"
          ? (attributesById.get(row.id) ?? null)
          : [],
      ),
    );
    const total = listResult.count ?? rows.length;
    const reached = offset + rows.length;
    // Never offer an offset this route refuses (changes-paging.ts): past the
    // ceiling the page says the list is capped instead.
    const hasNextPage =
      rows.length > 0 && reached < total && reached <= MAX_OFFSET;

    return NextResponse.json({
      sites,
      rows,
      total,
      counts: {
        pending: pending.count ?? 0,
        published: published.count ?? 0,
        original: original.count ?? 0,
      },
      nextOffset: hasNextPage ? reached : null,
    });
  } catch (error) {
    return failure("unexpected error", error);
  }
}
