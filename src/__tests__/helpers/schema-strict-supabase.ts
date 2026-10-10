/**
 * An in-memory Supabase client that knows which columns exist.
 *
 * Why it exists (s44): `/api/v1/content` 429'd every request in production
 * because its limiter queried `api_keys.rate_limit` and `rate_limits.key` /
 * `.timestamp` — columns no schema ever had — while its suite used a stub that
 * accepted any column on any table. That stub turned a limiter that could not
 * run into a green test. This double answers a query naming a column the table
 * does not have exactly as PostgREST does — with an error, not a row — so the
 * same mistake fails here.
 *
 * Columns come from `supabase/migrations/` (see `migration-columns.ts`), never
 * from a list kept by hand. Rows are plain objects held per table; inserts,
 * updates and deletes change them. Every query is recorded, refused ones
 * included, so a test can assert what a route did — and did not — ask for.
 *
 * Errors are returned in `{ error }`, never thrown, as supabase-js does:
 * - a read or filter on an unknown column → 42703 "column t.c does not exist";
 * - a write payload with an unknown column → PGRST204;
 * - a table no migration creates → 42P01;
 * - `.single()` without exactly one row, `.maybeSingle()` with several → PGRST116;
 * - an insert or update duplicating a declared unique key → 23505 (s89). Keys
 *   are opt-in per table (`uniqueKeys`), NULLs distinct as in PostgreSQL, and a
 *   refused write changes nothing.
 *
 * Supported: `select` (column lists and `*`, `{ count, head }`), `insert`,
 * `update`, `delete`, `eq/neq/gt/gte/lt/lte/is/in`, `order`, `limit`, `single`,
 * `maybeSingle`, and awaiting the builder. Anything else throws, so a test can
 * never pass by the double silently ignoring what the code asked.
 */

import { randomUUID } from "node:crypto";
import { migrationColumns, migrationFunctionExists } from "./migration-columns";

export type Row = Record<string, unknown>;

export interface DoubleError {
  code: string;
  message: string;
  details: null;
  hint: null;
}

type Operation = "select" | "insert" | "update" | "delete";
type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "in";

export interface RecordedFilter {
  column: string;
  operator: FilterOperator;
  value: unknown;
}

interface Ordering {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

export interface RecordedQuery {
  table: string;
  operation: Operation;
  /** Selected columns for a read; payload keys for a write. */
  columns: string[];
  filters: RecordedFilter[];
  error: DoubleError | null;
}

export interface QueryResult {
  data: unknown;
  error: DoubleError | null;
  count: number | null;
}

export interface RecordedRpc {
  name: string;
  args: Record<string, unknown>;
  error: DoubleError | null;
}

export type RpcHandler = (
  args: Record<string, unknown>,
) => QueryResult | Promise<QueryResult>;

function doubleError(code: string, message: string): DoubleError {
  return { code, message, details: null, hint: null };
}

function parseColumnList(list: string): string[] {
  return list
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => {
      if (!/^\*$|^\w+$/.test(column)) {
        throw new Error(
          `schema-strict double: unsupported select syntax "${column}" — extend the double`,
        );
      }
      return column;
    });
}

function keyValue(row: Row, key: readonly string[]): string | null {
  const values = key.map((column) => row[column] ?? null);
  return values.includes(null) ? null : JSON.stringify(values);
}

function compare(
  operator: FilterOperator,
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "is":
      return (actual ?? null) === expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    default: {
      if (actual === null || actual === undefined) return false;
      const a = actual as number | string;
      const b = expected as number | string;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
  }
}

class Table {
  constructor(
    readonly name: string,
    readonly columns: ReadonlySet<string> | undefined,
    readonly rows: Row[],
    readonly uniqueKeys: ReadonlyArray<readonly string[]> = [],
  ) {}

  /**
   * The first unique key `candidates` would duplicate — against the rows they
   * do not replace, or each other. A key with any NULL column never collides.
   */
  duplicateKey(candidates: Row[], replaced: Row[] = []): string | undefined {
    const others = this.rows.filter((row) => !replaced.includes(row));
    for (const key of this.uniqueKeys) {
      const seen = new Set(
        others
          .map((row) => keyValue(row, key))
          .filter((value): value is string => value !== null),
      );
      for (const candidate of candidates) {
        const value = keyValue(candidate, key);
        if (value === null) continue;
        if (seen.has(value)) return `${this.name}_${key.join("_")}_key`;
        seen.add(value);
      }
    }
    return undefined;
  }

  unknownColumn(names: Iterable<string>): string | undefined {
    if (!this.columns) return undefined;
    for (const name of names) {
      if (name !== "*" && !this.columns.has(name)) return name;
    }
    return undefined;
  }
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private operation: Operation = "select";
  private projection: string[] | null = null;
  private payload: Row[] = [];
  private filters: RecordedFilter[] = [];
  private rowLimit: number | null = null;
  private isHead = false;
  private isCounted = false;
  private isReturning = false;
  private orderings: Ordering[] = [];
  private rowOffset = 0;

  constructor(
    private readonly table: Table,
    private readonly record: (query: RecordedQuery) => void,
    private readonly maxRows: number | null = null,
  ) {}

  select(
    columns = "*",
    options: { count?: "exact"; head?: boolean } = {},
  ): this {
    this.projection = parseColumnList(columns);
    if (this.operation === "select") {
      this.isHead = Boolean(options.head);
      this.isCounted = options.count === "exact";
    } else {
      this.isReturning = true;
    }
    return this;
  }

  insert(values: Row | Row[]): this {
    this.operation = "insert";
    this.payload = (Array.isArray(values) ? values : [values]).map((row) => ({
      ...row,
    }));
    return this;
  }

  update(patch: Row): this {
    this.operation = "update";
    this.payload = [{ ...patch }];
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  private filter(operator: FilterOperator, column: string, value: unknown) {
    this.filters.push({ column, operator, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.filter("eq", column, value);
  }
  neq(column: string, value: unknown): this {
    return this.filter("neq", column, value);
  }
  gt(column: string, value: unknown): this {
    return this.filter("gt", column, value);
  }
  gte(column: string, value: unknown): this {
    return this.filter("gte", column, value);
  }
  lt(column: string, value: unknown): this {
    return this.filter("lt", column, value);
  }
  lte(column: string, value: unknown): this {
    return this.filter("lte", column, value);
  }
  is(column: string, value: null | boolean): this {
    return this.filter("is", column, value);
  }
  in(column: string, values: unknown[]): this {
    return this.filter("in", column, values);
  }

  /**
   * Chained calls sort by each key in turn, as PostgREST's `order=a,b` does.
   * Nulls follow PostgreSQL: last when ascending, FIRST when descending,
   * unless `nullsFirst` says otherwise (s88, Devin on PR #83: a descending
   * read without `nullsFirst: false` puts undated rows on top).
   */
  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {},
  ): this {
    const ascending = options.ascending !== false;
    this.orderings.push({
      column,
      ascending,
      nullsFirst: options.nullsFirst ?? !ascending,
    });
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  /** Rows `from`..`to` inclusive, as supabase-js `range` sends `offset`/`limit`. */
  range(from: number, to: number): this {
    this.rowOffset = from;
    this.rowLimit = to - from + 1;
    return this;
  }

  async single(): Promise<QueryResult> {
    return this.singleRow(false);
  }

  async maybeSingle(): Promise<QueryResult> {
    return this.singleRow(true);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private singleRow(isMaybe: boolean): QueryResult {
    const result = this.execute();
    if (result.error) return result;

    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length === 1) return { ...result, data: rows[0] };
    if (rows.length === 0 && isMaybe) return { ...result, data: null };

    return {
      data: null,
      count: null,
      error: doubleError(
        "PGRST116",
        `JSON object requested, multiple (or no) rows returned (${rows.length} rows)`,
      ),
    };
  }

  /** The first schema violation in this query, as PostgREST would report it. */
  private violation(): DoubleError | null {
    const { table } = this;
    if (!table.columns) {
      return doubleError(
        "42P01",
        `relation "public.${table.name}" does not exist`,
      );
    }

    const payloadColumn = table.unknownColumn(
      this.payload.flatMap((row) => Object.keys(row)),
    );
    if (payloadColumn) {
      return doubleError(
        "PGRST204",
        `Could not find the '${payloadColumn}' column of '${table.name}' in the schema cache`,
      );
    }

    const readColumn = table.unknownColumn([
      ...(this.projection ?? []),
      ...this.filters.map((filter) => filter.column),
      ...this.orderings.map((ordering) => ordering.column),
    ]);
    if (readColumn) {
      return doubleError(
        "42703",
        `column ${table.name}.${readColumn} does not exist`,
      );
    }

    return null;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) =>
      compare(filter.operator, row[filter.column], filter.value),
    );
  }

  private project(row: Row): Row {
    const columns = this.projection ?? ["*"];
    if (columns.includes("*")) {
      return Object.fromEntries(
        [...(this.table.columns ?? [])].map((column) => [
          column,
          row[column] ?? null,
        ]),
      );
    }
    return Object.fromEntries(
      columns.map((column) => [column, row[column] ?? null]),
    );
  }

  private execute(): QueryResult {
    const error = this.violation() ?? this.conflict();
    this.record({
      table: this.table.name,
      operation: this.operation,
      columns:
        this.operation === "select" || this.operation === "delete"
          ? [...(this.projection ?? ["*"])]
          : [...new Set(this.payload.flatMap((row) => Object.keys(row)))],
      filters: [...this.filters],
      error,
    });

    if (error) return { data: null, error, count: null };

    const affected = this.apply();
    const returned =
      this.operation === "select" || this.isReturning
        ? affected.map((row) => this.project(row))
        : null;

    if (this.operation === "select" && this.isHead) {
      return {
        data: null,
        error: null,
        count: this.isCounted ? affected.length : null,
      };
    }

    return {
      data: returned,
      error: null,
      count: this.isCounted ? affected.length : null,
    };
  }

  /** A write that would duplicate a unique key, refused before anything is written. */
  private conflict(): DoubleError | null {
    let duplicate: string | undefined;
    if (this.operation === "insert") {
      duplicate = this.table.duplicateKey(this.payload);
    } else if (this.operation === "update") {
      const matched = this.table.rows.filter((row) => this.matches(row));
      duplicate = this.table.duplicateKey(
        matched.map((row) => ({ ...row, ...this.payload[0] })),
        matched,
      );
    }
    return duplicate
      ? doubleError(
          "23505",
          `duplicate key value violates unique constraint "${duplicate}"`,
        )
      : null;
  }

  /** Mutates the table for writes; returns the rows the query touched. */
  private apply(): Row[] {
    const { rows } = this.table;

    if (this.operation === "insert") {
      const inserted = this.payload.map((row) => ({
        ...(this.table.columns?.has("id") ? { id: randomUUID() } : {}),
        ...row,
      }));
      rows.push(...inserted);
      return inserted;
    }

    const matched = rows.filter((row) => this.matches(row));

    if (this.operation === "update") {
      const updated = matched.map((row) => ({ ...row, ...this.payload[0] }));
      const next = rows.map((row) => {
        const position = matched.indexOf(row);
        return position === -1 ? row : updated[position];
      });
      rows.splice(0, rows.length, ...next);
      return updated;
    }

    if (this.operation === "delete") {
      const kept = rows.filter((row) => !matched.includes(row));
      rows.splice(0, rows.length, ...kept);
      return matched;
    }

    const ordered = this.orderings.length > 0 ? this.sorted(matched) : matched;
    const end =
      this.rowLimit === null ? undefined : this.rowOffset + this.rowLimit;
    const page = ordered.slice(this.rowOffset, end);
    // PostgREST's `max_rows` caps every response, whatever the request asked.
    return this.maxRows === null ? page : page.slice(0, this.maxRows);
  }

  private sorted(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => {
      for (const { column, ascending, nullsFirst } of this.orderings) {
        const left = a[column];
        const right = b[column];
        const isLeftNull = left === null || left === undefined;
        const isRightNull = right === null || right === undefined;
        if (isLeftNull && isRightNull) continue;
        if (isLeftNull) return nullsFirst ? -1 : 1;
        if (isRightNull) return nullsFirst ? 1 : -1;
        if (left === right) continue;
        const order =
          (left as string | number) < (right as string | number) ? -1 : 1;
        return ascending ? order : -order;
      }
      return 0;
    });
  }
}

export interface SchemaStrictDatabase {
  /** Pass this wherever the code expects a Supabase client. */
  client: {
    from: (table: string) => QueryBuilder;
    rpc: (name: string, args?: Record<string, unknown>) => Promise<QueryResult>;
  };
  /** Add rows. Throws on a column the table does not have: fixtures lie too. */
  seed: (table: string, rows: Row[]) => void;
  /** A copy of the table's current rows. */
  rows: (table: string) => Row[];
  /** Every query executed, in order. */
  queries: RecordedQuery[];
  queriesOn: (table: string) => RecordedQuery[];
  /** Every RPC call executed, including an unknown migration function. */
  rpcCalls: RecordedRpc[];
}

export interface SchemaStrictOptions {
  /**
   * `maxRows` models PostgREST's `max_rows` (supabase/config.toml): no response
   * carries more rows than that, whatever `limit` or `range` asked for.
   */
  maxRows?: number;
  /**
   * Unique keys to enforce, per table — each an array of columns. Opt-in: the
   * double does not read indexes out of the migrations.
   */
  uniqueKeys?: Record<string, ReadonlyArray<readonly string[]>>;
  /**
   * Behavior for migration-defined RPCs used by the subject under test. A name
   * absent from the migration ledger returns 42883; a real function without a
   * handler throws instead of silently inventing database behavior.
   */
  rpcHandlers?: Record<string, RpcHandler>;
}

export function createSchemaStrictDatabase(
  options: SchemaStrictOptions = {},
): SchemaStrictDatabase {
  const maxRows = options.maxRows ?? null;
  const tables = new Map<string, Table>();
  const queries: RecordedQuery[] = [];
  const rpcCalls: RecordedRpc[] = [];

  function table(name: string): Table {
    let existing = tables.get(name);
    if (!existing) {
      existing = new Table(
        name,
        migrationColumns(name),
        [],
        options.uniqueKeys?.[name] ?? [],
      );
      tables.set(name, existing);
    }
    return existing;
  }

  return {
    client: {
      from: (name: string) =>
        new QueryBuilder(table(name), (query) => queries.push(query), maxRows),
      async rpc(name: string, args: Record<string, unknown> = {}) {
        if (!migrationFunctionExists(name)) {
          const error = doubleError(
            "42883",
            `function public.${name} does not exist`,
          );
          rpcCalls.push({ name, args: { ...args }, error });
          return { data: null, error, count: null };
        }

        const handler = options.rpcHandlers?.[name];
        if (!handler) {
          throw new Error(
            `schema-strict double: migration defines RPC "${name}", but this test supplied no handler`,
          );
        }
        const result = await handler({ ...args });
        rpcCalls.push({ name, args: { ...args }, error: result.error });
        return result;
      },
    },
    seed(name, rows) {
      const target = table(name);
      if (!target.columns) {
        throw new Error(`seed: no migration creates table "${name}"`);
      }
      for (const row of rows) {
        const unknown = target.unknownColumn(Object.keys(row));
        if (unknown) {
          throw new Error(
            `seed: ${name}.${unknown} is not a column any migration creates`,
          );
        }
        target.rows.push({ ...row });
      }
    },
    rows: (name) => table(name).rows.map((row) => ({ ...row })),
    queries,
    queriesOn: (name) => queries.filter((query) => query.table === name),
    rpcCalls,
  };
}
