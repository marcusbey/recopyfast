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
 * - `.single()` without exactly one row, `.maybeSingle()` with several → PGRST116.
 *
 * Supported: `select` (column lists and `*`, `{ count, head }`), `insert`,
 * `update`, `delete`, `eq/neq/gt/gte/lt/lte/is/in`, `order`, `limit`, `single`,
 * `maybeSingle`, and awaiting the builder. Anything else throws, so a test can
 * never pass by the double silently ignoring what the code asked.
 */

import { randomUUID } from "node:crypto";
import { migrationColumns } from "./migration-columns";

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

export interface RecordedQuery {
  table: string;
  operation: Operation;
  /** Selected columns for a read; payload keys for a write. */
  columns: string[];
  filters: RecordedFilter[];
  error: DoubleError | null;
}

interface QueryResult {
  data: unknown;
  error: DoubleError | null;
  count: number | null;
}

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
  ) {}

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
  private ordering: { column: string; ascending: boolean } | null = null;

  constructor(
    private readonly table: Table,
    private readonly record: (query: RecordedQuery) => void,
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

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.ordering = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
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
      ...(this.ordering ? [this.ordering.column] : []),
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
    const error = this.violation();
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

    const ordered = this.ordering ? this.sorted(matched) : matched;
    return this.rowLimit === null ? ordered : ordered.slice(0, this.rowLimit);
  }

  private sorted(rows: Row[]): Row[] {
    const { column, ascending } = this.ordering!;
    return [...rows].sort((a, b) => {
      const left = a[column] as string | number;
      const right = b[column] as string | number;
      if (left === right) return 0;
      const order = left < right ? -1 : 1;
      return ascending ? order : -order;
    });
  }
}

export interface SchemaStrictDatabase {
  /** Pass this wherever the code expects a Supabase client. */
  client: { from: (table: string) => QueryBuilder };
  /** Add rows. Throws on a column the table does not have: fixtures lie too. */
  seed: (table: string, rows: Row[]) => void;
  /** A copy of the table's current rows. */
  rows: (table: string) => Row[];
  /** Every query executed, in order. */
  queries: RecordedQuery[];
  queriesOn: (table: string) => RecordedQuery[];
}

export function createSchemaStrictDatabase(): SchemaStrictDatabase {
  const tables = new Map<string, Table>();
  const queries: RecordedQuery[] = [];

  function table(name: string): Table {
    let existing = tables.get(name);
    if (!existing) {
      existing = new Table(name, migrationColumns(name), []);
      tables.set(name, existing);
    }
    return existing;
  }

  return {
    client: {
      from: (name: string) =>
        new QueryBuilder(table(name), (query) => queries.push(query)),
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
  };
}
