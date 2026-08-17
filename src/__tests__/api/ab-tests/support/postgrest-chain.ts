/**
 * A stand-in for a PostgREST query builder, shared by the A/B route tests.
 *
 * Not a test file: `jest.config.js` only treats `*.test.*` as a suite, so this
 * is a helper the suites import.
 *
 * The real builder is a chainable thenable — every filter returns the builder
 * and awaiting it runs the query — and the routes lean on that shape, so the
 * mock has to have it too. It also records the `.order()` calls, because
 * "did this route ask Postgres for a deterministic order" is otherwise
 * unobservable from outside.
 */

export interface OrderCall {
  column: string;
  options?: { ascending?: boolean; referencedTable?: string };
}

export interface QueryResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export interface ChainOptions {
  /**
   * What awaiting the builder resolves to. An array is a queue: each await
   * takes the next entry, and the last one repeats, which is how a route that
   * queries the same table twice gets two different answers.
   */
  result?: QueryResult | QueryResult[];
  insert?: QueryResult | (() => Promise<QueryResult>);
  upsert?: QueryResult | (() => Promise<QueryResult>);
}

export interface TableChain {
  orders: OrderCall[];
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  insert: jest.Mock;
  upsert: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function resolver(
  value: QueryResult | (() => Promise<QueryResult>) | undefined,
): () => Promise<QueryResult> {
  if (typeof value === "function") return value;
  return () => Promise.resolve(value ?? { error: null });
}

export function createChain(options: ChainOptions = {}): TableChain {
  const queue = Array.isArray(options.result)
    ? [...options.result]
    : [options.result ?? { data: [], error: null }];

  const orders: OrderCall[] = [];
  const chain = {
    orders,
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn((column: string, opts?: OrderCall["options"]) => {
      orders.push({ column, options: opts });
      return chain;
    }),
    insert: jest.fn(() => resolver(options.insert)()),
    upsert: jest.fn(() => resolver(options.upsert)()),
    single: jest.fn(() => Promise.resolve(queue[0])),
    maybeSingle: jest.fn(() => Promise.resolve(queue[0])),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return Promise.resolve(next).then(resolve, reject);
    },
  } as TableChain;

  return chain;
}

/**
 * Wires `createServiceRoleClient` to a per-table set of chains. Any table the
 * test did not declare throws rather than returning a silently empty builder —
 * a route reading a table nobody expected is worth a loud failure.
 */
export function mockServiceClient(
  createServiceRoleClient: jest.Mock,
  tables: Record<string, TableChain>,
) {
  const client = {
    from: jest.fn((table: string) => {
      const chain = tables[table];
      if (!chain) throw new Error(`unexpected table: ${table}`);
      return chain;
    }),
  };
  createServiceRoleClient.mockReturnValue(client);
  return client;
}
