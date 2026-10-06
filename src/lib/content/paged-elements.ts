const CONTENT_ELEMENT_PAGE_SIZE = 1000;

type QueryResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
  count?: number | null;
};

type QueryScope =
  | { kind: "all" }
  | { kind: "page"; pagePath: string }
  | { kind: "shared" };

type QueryBuilder<T> = PromiseLike<QueryResult<T>> & {
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T>;
  range: (from: number, to: number) => QueryBuilder<T>;
};

function isReliableExactCount(
  count: number | null | undefined,
): count is number {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
}

async function collectPages<T>(buildQuery: () => QueryBuilder<T>) {
  const rows: T[] = [];
  let offset = 0;
  let exactCountTarget: number | null = null;
  let canUseExactCount = true;

  for (;;) {
    let query = buildQuery();
    query = query.order("element_id", { ascending: true });
    query = query.order("id", { ascending: true });
    query = query.range(offset, offset + CONTENT_ELEMENT_PAGE_SIZE - 1);

    const result = await query;
    if (result.error) return { data: null, error: result.error };

    // s60: the public read asks PostgREST for an exact count so the common
    // 223-row page does not wait for a second, known-empty request. Refresh the
    // target from every valid response: an insert before the current offset can
    // repeat a boundary row and move the old tail onto one more page. Freezing
    // the first count would then stop before that tail. Conversely, once any
    // response omits or corrupts the count, keep this scope on the proven
    // empty-page fallback; a later count cannot repair the blind page.
    if (canUseExactCount) {
      if (isReliableExactCount(result.count)) {
        exactCountTarget = result.count;
      } else {
        canUseExactCount = false;
        exactCountTarget = null;
      }
    }

    const page = result.data ?? [];
    if (page.length === 0) {
      return { data: rows, error: null };
    }

    rows.push(...page);
    // Never slice to the latest count. Concurrent inserts or deletes can shift
    // offset pages so they repeat or omit rows; every row the database did
    // return must survive even when the cumulative length passes that count.
    if (exactCountTarget !== null && rows.length >= exactCountTarget) {
      return { data: rows, error: null };
    }

    // PostgREST may enforce a server max_rows smaller than the requested
    // range. Advancing by the request size skips rows after any capped page;
    // stopping on a short page truncates the result. Only an empty response is
    // terminal, and the next range begins after the rows actually received.
    offset += page.length;
  }
}

/**
 * Read a page's local rows plus author-declared shared rows without relying on
 * a raw PostgREST `.or()` string built from a caller-controlled pathname.
 * Separate equality/NULL queries keep punctuation in paths as data, and the
 * explicit ranges prevent PostgREST's 1,000-row response cap from silently
 * dropping content. An omitted page path retains the legacy all-site read.
 */
export async function fetchPageScopedRows<
  T extends { id: string | number; element_id: string },
>(buildQuery: (scope: QueryScope) => QueryBuilder<T>, pagePath: string | null) {
  if (pagePath === null) {
    return collectPages(() => buildQuery({ kind: "all" }));
  }

  const [page, shared] = await Promise.all([
    collectPages(() => buildQuery({ kind: "page", pagePath })),
    collectPages(() => buildQuery({ kind: "shared" })),
  ]);
  if (page.error) return page;
  if (shared.error) return shared;

  return {
    data: [...(page.data ?? []), ...(shared.data ?? [])].sort(
      (left, right) =>
        left.element_id.localeCompare(right.element_id) ||
        String(left.id).localeCompare(String(right.id)),
    ),
    error: null,
  };
}
