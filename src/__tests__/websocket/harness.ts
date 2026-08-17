/**
 * Shared machinery for the realtime-service integration suites.
 *
 * Not a `*.test.ts`, so jest's `testMatch` leaves it alone (a previous pattern
 * swept helpers like this one up and failed them as empty suites).
 *
 * Two things live here and nothing else: a Supabase double that behaves enough
 * like PostgREST for the server's real queries to run against it *and records
 * every write it is asked to perform*, and the client-side plumbing for driving
 * a real `socket.io-client` against a real listener.
 *
 * The recording is the point. "The socket never writes to the database" (ADR
 * 004 rule 1) is asserted by driving every event the server still accepts and
 * then reading `db.writes` — a property of the running server, not a claim
 * about its source.
 */

import { createHmac } from "node:crypto";
import { io as ioClient, type Socket } from "socket.io-client";

export interface SiteRow {
  id: string;
  domain: string | null;
  api_key: string;
}

export type Row = Record<string, unknown>;

export interface RecordedWrite {
  table: string;
  op: "insert" | "update" | "upsert" | "rpc";
  payload: unknown;
}

type Filter = {
  op: "eq" | "gt" | "gte" | "lt" | "lte" | "is" | "not";
  column: string;
  value: unknown;
};

function matches(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "is":
      return filter.value === null
        ? actual === null || actual === undefined
        : actual === filter.value;
    case "not":
      return filter.value === null
        ? actual !== null && actual !== undefined
        : actual !== filter.value;
    case "gt":
      return String(actual) > String(filter.value);
    case "gte":
      return String(actual) >= String(filter.value);
    case "lt":
      return String(actual) < String(filter.value);
    case "lte":
      return String(actual) <= String(filter.value);
    default:
      return false;
  }
}

/**
 * A minimal PostgREST-shaped double over in-memory tables.
 *
 * It filters for real rather than returning a canned row, so a test that flips
 * `is_active` to false or stamps `revoked_at` changes what the server's own
 * query returns — which is the difference between testing revocation and
 * testing a mock's `mockResolvedValueOnce`.
 */
export class RecordingSupabase {
  readonly tables: Record<string, Row[]> = {};
  readonly writes: RecordedWrite[] = [];
  readonly reads: string[] = [];

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables[table] = rows.map((row) => ({ ...row }));
    }
  }

  rows(table: string): Row[] {
    if (!this.tables[table]) {
      this.tables[table] = [];
    }
    return this.tables[table];
  }

  from(table: string) {
    return createQueryBuilder(this, table);
  }

  async rpc(fn: string, args: unknown) {
    this.writes.push({ table: fn, op: "rpc", payload: args });
    return { data: null, error: null };
  }
}

/**
 * Built outside the class and handed the store explicitly.
 *
 * The chainable builder's methods each need to reach the store, and a PostgREST
 * builder is an object literal rather than a class — so an inline version has
 * to alias `this`, which the lint config forbids for good reason. Passing `db`
 * as a parameter says the same thing without the alias.
 */
function createQueryBuilder(db: RecordingSupabase, table: string) {
  const filters: Filter[] = [];
  let op: RecordedWrite["op"] | null = null;
  let payload: unknown = null;

  const settle = async () => {
    if (op) {
      db.writes.push({ table, op, payload });
    }
    return { data: null, error: null };
  };

  const builder = {
    select() {
      db.reads.push(table);
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    gt(column: string, value: unknown) {
      filters.push({ op: "gt", column, value });
      return builder;
    },
    gte(column: string, value: unknown) {
      filters.push({ op: "gte", column, value });
      return builder;
    },
    lt(column: string, value: unknown) {
      filters.push({ op: "lt", column, value });
      return builder;
    },
    lte(column: string, value: unknown) {
      filters.push({ op: "lte", column, value });
      return builder;
    },
    is(column: string, value: unknown) {
      filters.push({ op: "is", column, value });
      return builder;
    },
    not(column: string, _operator: string, value: unknown) {
      filters.push({ op: "not", column, value });
      return builder;
    },
    limit() {
      return builder;
    },
    update(next: Row) {
      op = "update";
      payload = next;
      return builder;
    },
    insert(next: Row | Row[]) {
      op = "insert";
      payload = next;
      return builder;
    },
    upsert(next: Row | Row[]) {
      op = "upsert";
      payload = next;
      return builder;
    },
    matching(): Row[] {
      return db
        .rows(table)
        .filter((row) => filters.every((filter) => matches(row, filter)));
    },
    async single() {
      if (op) return settle();
      const found = builder.matching();
      if (found.length !== 1) {
        return { data: null, error: { message: "No rows found" } };
      }
      return { data: { ...found[0] }, error: null };
    },
    async maybeSingle() {
      if (op) return settle();
      const found = builder.matching();
      return { data: found.length > 0 ? { ...found[0] } : null, error: null };
    },
    then(
      onFulfilled: (value: { data: null; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return settle().then(onFulfilled, onRejected);
    },
  };

  return builder;
}

/** A store that always throws, for the fail-closed rate-limit case. */
export function throwingStore() {
  return {
    async increment(): Promise<number> {
      throw new Error("store unavailable");
    },
  };
}

/** An in-memory counter store with the same contract as the Redis one. */
export function memoryStore() {
  const counters = new Map<string, number>();
  return {
    async increment(key: string): Promise<number> {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    reset() {
      counters.clear();
    },
  };
}

export function buildSiteToken(
  siteId: string,
  apiKey: string,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload = `${siteId}.${issuedAtSeconds}`;
  const signature = createHmac("sha256", apiKey).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export interface HandshakeOptions {
  port: number;
  query: Record<string, string>;
  origin?: string | null;
  referer?: string | null;
}

export function openSocket(options: HandshakeOptions): Socket {
  const extraHeaders: Record<string, string> = {};
  if (options.origin) extraHeaders.Origin = options.origin;
  if (options.referer) extraHeaders.Referer = options.referer;

  return ioClient(`http://127.0.0.1:${options.port}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    query: options.query,
    extraHeaders,
  });
}

/**
 * Poll until a condition holds, rather than sleeping a fixed grace period.
 *
 * The server refuses a connection *after* the socket has connected — it emits
 * `auth-error` and then disconnects, which is the contract the widget listens
 * for (recopyfast.src.js:2745) and is therefore not up for renegotiation here.
 * A fixed sleep would make every refusal assertion a race; waiting on the
 * observable outcome does not.
 */
export async function waitFor(
  predicate: () => boolean,
  description: string,
  // Generous, because the alternative is a suite that goes red when the machine
  // is busy rather than when the server is wrong. It still fails well inside
  // jest's own ceiling for this file, and it names the condition it gave up on.
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

export interface HandshakeOutcome {
  socket: Socket;
  authErrors: Array<{ error?: string; message?: string }>;
  /** Resolves once the socket has been refused and closed. */
  refused: () => Promise<string | undefined>;
}

export function track(socket: Socket): HandshakeOutcome {
  const authErrors: Array<{ error?: string; message?: string }> = [];
  socket.on("auth-error", (payload) => {
    authErrors.push(payload);
  });
  socket.on("connect_error", (error: Error) => {
    authErrors.push({ error: error.message });
  });

  return {
    socket,
    authErrors,
    async refused() {
      await waitFor(
        () => socket.disconnected && !socket.active,
        "the socket to be refused and closed",
      );
      return authErrors[0]?.error ?? authErrors[0]?.message;
    },
  };
}
