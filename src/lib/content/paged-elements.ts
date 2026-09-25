const CONTENT_ELEMENT_PAGE_SIZE = 1000;

type QueryResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

type QueryScope =
  | { kind: "all" }
  | { kind: "page"; pagePath: string }
  | { kind: "shared" };

type QueryBuilder<T> = PromiseLike<QueryResult<T>> & {
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T>;
  range: (from: number, to: number) => QueryBuilder<T>;
};

async function collectPages<T>(buildQuery: () => QueryBuilder<T>) {
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    let query = buildQuery();
    query = query.order("element_id", { ascending: true });
    query = query.order("id", { ascending: true });
    query = query.range(offset, offset + CONTENT_ELEMENT_PAGE_SIZE - 1);

    const result = await query;
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    if (page.length === 0) {
      return { data: rows, error: null };
    }

    rows.push(...page);
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
