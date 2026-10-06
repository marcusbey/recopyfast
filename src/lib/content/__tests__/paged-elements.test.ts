import { fetchPageScopedRows } from "@/lib/content/paged-elements";

interface Row {
  id: string;
  element_id: string;
}

interface QueryError {
  message?: string;
}

interface QueryResult {
  data: Row[] | null;
  error: QueryError | null;
  count?: number | null;
}

type QueryScope =
  | { kind: "all" }
  | { kind: "page"; pagePath: string }
  | { kind: "shared" };

interface QueryCall {
  scope: QueryScope;
  scopeIndex: number;
  from: number;
  to: number;
  orders: Array<{ column: string; ascending?: boolean }>;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
}

function scopeKey(scope: QueryScope): string {
  return scope.kind === "page" ? `page:${scope.pagePath}` : scope.kind;
}

function makeHarness(
  resolveResult: (call: QueryCall) => QueryResult | Promise<QueryResult>,
) {
  const calls: QueryCall[] = [];
  const callsByScope = new Map<string, number>();

  const buildQuery = (scope: QueryScope): QueryBuilder => {
    const orders: QueryCall["orders"] = [];
    let from = -1;
    let to = -1;

    const query: QueryBuilder = {
      order(column, options) {
        orders.push({ column, ascending: options?.ascending });
        return query;
      },
      range(nextFrom, nextTo) {
        from = nextFrom;
        to = nextTo;
        return query;
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?:
          | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): Promise<TResult1 | TResult2> {
        const key = scopeKey(scope);
        const scopeIndex = callsByScope.get(key) ?? 0;
        callsByScope.set(key, scopeIndex + 1);

        const call = {
          scope,
          scopeIndex,
          from,
          to,
          orders: [...orders],
        };
        calls.push(call);

        return Promise.resolve(resolveResult(call)).then(
          onfulfilled,
          onrejected,
        );
      },
    };

    return query;
  };

  return { buildQuery, calls };
}

function makeRows(prefix: string, count: number, start = 0): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `${prefix}-id-${String(start + index).padStart(4, "0")}`,
    element_id: `${prefix}-${String(start + index).padStart(4, "0")}`,
  }));
}

function success(data: Row[], count?: number | null): QueryResult {
  return count === undefined
    ? { data, error: null }
    : { data, error: null, count };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("fetchPageScopedRows exact-count pagination", () => {
  it("returns 223 exactly counted rows after one query", async () => {
    const expected = makeRows("page", 223);
    const harness = makeHarness(({ scopeIndex }) =>
      scopeIndex === 0 ? success(expected, 223) : success([], 223),
    );

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result).toEqual({ data: expected, error: null });
    expect(harness.calls).toHaveLength(1);
  });

  it("keeps paging through a server cap smaller than the requested range", async () => {
    const first = makeRows("row", 100);
    const second = makeRows("row", 100, 100);
    const third = makeRows("row", 23, 200);
    const pages = [first, second, third];
    const harness = makeHarness(({ scopeIndex }) =>
      success(pages[scopeIndex] ?? [], 223),
    );

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result.data).toEqual([...first, ...second, ...third]);
    expect(harness.calls.map(({ from, to }) => [from, to])).toEqual([
      [0, 999],
      [100, 1099],
      [200, 1199],
    ]);
  });

  it("updates a growing exact count so an inserted boundary row does not hide the original tail", async () => {
    const original = makeRows("row", 200);
    const first = original.slice(0, 100);
    // A new row sorts before this range between requests. Offset 100 now
    // repeats the old boundary row, so the old final row moves to page three.
    const second = [original[99], ...original.slice(100, 199)];
    const third = [original[199]];
    const harness = makeHarness(({ scopeIndex }) => {
      if (scopeIndex === 0) return success(first, 200);
      if (scopeIndex === 1) return success(second, 201);
      if (scopeIndex === 2) return success(third, 201);
      return success([], 201);
    });

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result.data).toEqual([...first, ...second, ...third]);
    expect(result.data).toContainEqual(original[199]);
    expect(harness.calls).toHaveLength(3);
  });

  it("accepts an exact zero count with an empty result", async () => {
    const harness = makeHarness(() => success([], 0));

    await expect(
      fetchPageScopedRows(harness.buildQuery, null),
    ).resolves.toEqual({ data: [], error: null });
    expect(harness.calls).toHaveLength(1);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["numeric string", "1" as unknown as number],
  ])("uses empty-page termination for a %s count", async (_label, count) => {
    const row = makeRows("fallback", 1);
    const harness = makeHarness(({ scopeIndex }) =>
      scopeIndex === 0 ? success(row, count) : success([], count),
    );

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result).toEqual({ data: row, error: null });
    expect(harness.calls).toHaveLength(2);
  });

  it("does not adopt a later count when the initial response had none", async () => {
    const first = makeRows("fallback", 100);
    const second = makeRows("fallback", 23, 100);
    const harness = makeHarness(({ scopeIndex }) => {
      if (scopeIndex === 0) return success(first);
      if (scopeIndex === 1) return success(second, 123);
      return success([], 123);
    });

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result.data).toEqual([...first, ...second]);
    expect(harness.calls).toHaveLength(3);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["negative", -1],
    ["fractional", 149.5],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])(
    "falls back to empty-page termination when a later count is %s",
    async (_label, laterCount) => {
      const first = makeRows("fallback-later", 100);
      const second = makeRows("fallback-later", 100, 100);
      const third = makeRows("fallback-later", 50, 200);
      const harness = makeHarness(({ scopeIndex }) => {
        if (scopeIndex === 0) return success(first, 250);
        if (scopeIndex === 1) return success(second, laterCount);
        if (scopeIndex === 2) return success(third, 250);
        return success([], 250);
      });

      const result = await fetchPageScopedRows(harness.buildQuery, null);

      expect(result.data).toEqual([...first, ...second, ...third]);
      expect(harness.calls).toHaveLength(4);
    },
  );

  it("still terminates on an empty page when the initial count is stale high", async () => {
    const available = makeRows("stale-high", 2);
    const harness = makeHarness(({ scopeIndex }) =>
      scopeIndex === 0 ? success(available, 10) : success([], 10),
    );

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result).toEqual({ data: available, error: null });
    expect(harness.calls).toHaveLength(2);
  });

  it("preserves a complete returned page when the initial count is stale low", async () => {
    const first = makeRows("stale-low", 100);
    const second = makeRows("stale-low", 100, 100);
    const harness = makeHarness(({ scopeIndex }) => {
      if (scopeIndex === 0) return success(first, 150);
      if (scopeIndex === 1) return success(second, 150);
      return success([], 150);
    });

    const result = await fetchPageScopedRows(harness.buildQuery, null);

    expect(result).toEqual({ data: [...first, ...second], error: null });
    expect(harness.calls).toHaveLength(2);
  });

  it("propagates an error from the first query", async () => {
    const error = { message: "database unavailable" };
    const harness = makeHarness(() => ({ data: null, error, count: null }));

    await expect(
      fetchPageScopedRows(harness.buildQuery, null),
    ).resolves.toEqual({ data: null, error });
    expect(harness.calls).toHaveLength(1);
  });

  it("propagates a later pagination error without returning partial rows", async () => {
    const error = { message: "second page failed" };
    const harness = makeHarness(({ scopeIndex }) =>
      scopeIndex === 0
        ? success(makeRows("partial", 100), 200)
        : { data: null, error, count: 200 },
    );

    await expect(
      fetchPageScopedRows(harness.buildQuery, null),
    ).resolves.toEqual({ data: null, error });
    expect(harness.calls).toHaveLength(2);
  });

  it("reads page and shared counts in parallel, then sorts their rows deterministically", async () => {
    const pageResult = deferred<QueryResult>();
    const sharedResult = deferred<QueryResult>();
    const harness = makeHarness(({ scope, scopeIndex }) => {
      if (scopeIndex > 0) {
        return success([], scope.kind === "page" ? 2 : 1);
      }
      return scope.kind === "page" ? pageResult.promise : sharedResult.promise;
    });

    const pending = fetchPageScopedRows(harness.buildQuery, "/pricing");
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.calls.map(({ scope }) => scope.kind).sort()).toEqual([
      "page",
      "shared",
    ]);

    sharedResult.resolve(success([{ id: "a", element_id: "same" }], 1));
    pageResult.resolve(
      success(
        [
          { id: "z", element_id: "zeta" },
          { id: "b", element_id: "same" },
        ],
        2,
      ),
    );

    await expect(pending).resolves.toEqual({
      data: [
        { id: "a", element_id: "same" },
        { id: "b", element_id: "same" },
        { id: "z", element_id: "zeta" },
      ],
      error: null,
    });
    expect(harness.calls).toHaveLength(2);
    for (const call of harness.calls) {
      expect(call.orders).toEqual([
        { column: "element_id", ascending: true },
        { column: "id", ascending: true },
      ]);
    }
  });
});
