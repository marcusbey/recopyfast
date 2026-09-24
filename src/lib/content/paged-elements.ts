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

  for (let offset = 0; ; offset += CONTENT_ELEMENT_PAGE_SIZE) {
    let query = buildQuery();
    query = query.order("element_id", { ascending: true });
    query = query.order("id", { ascending: true });
    query = query.range(offset, offset + CONTENT_ELEMENT_PAGE_SIZE - 1);

    const result = await query;
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < CONTENT_ELEMENT_PAGE_SIZE) {
      return { data: rows, error: null };
    }
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

  const page = await collectPages(() => buildQuery({ kind: "page", pagePath }));
  if (page.error) return page;

  const shared = await collectPages(() => buildQuery({ kind: "shared" }));
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
