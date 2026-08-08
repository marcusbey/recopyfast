/**
 * A-11 (registration half) — POST /api/sites/register is not atomic.
 *
 * The route inserts into `sites`, then upserts `site_permissions` as a second,
 * independent statement (src/app/api/sites/register/route.ts:120-156). When the
 * permission write fails it returns 500 and leaves the `sites` row behind.
 *
 * That orphan is not merely untidy. `domain` is UNIQUE, and the `sites` SELECT
 * policy authorises *through* `site_permissions` — so the row is invisible to
 * everybody, deletable by nobody, and every later attempt to register the same
 * domain is answered "Domain already registered". The customer is permanently
 * locked out of their own domain by a transient failure.
 *
 * These assertions are on stored state, not on the status code: the 500 is
 * correct and is not the defect. What must be true after a failed registration
 * is that no `sites` row survives for that domain.
 *
 * Both cases are `test.failing`: they pass while the bug is present and start
 * failing the moment registration is made atomic (a transaction, an RPC, or a
 * compensating delete on the permission failure), which is the signal to drop
 * the marker.
 */

import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// A small stateful stand-in for PostgREST. It is stateful on purpose: the whole
// finding is about what rows are left behind, which a `jest.fn()` returning a
// canned `{ data, error }` cannot express.
// ---------------------------------------------------------------------------

interface SiteRow {
  id: string;
  domain: string;
  name: string;
  created_at: string;
  api_key: string;
}

interface PermissionRow {
  site_id: string;
  user_id: string;
  permission: string;
}

class FakeDb {
  sites: SiteRow[] = [];
  sitePermissions: PermissionRow[] = [];
  /** Flipped on to simulate the transient failure the route mishandles. */
  failPermissionWrite = false;
  private nextId = 1;

  /**
   * Full reset, id counter included. The control test asserts the literal
   * `site-1`; leaving the counter running would make that assertion depend on
   * how many tests happened to execute before it, so `-t`, a new test above it
   * or a randomised order would break it for reasons unrelated to the route.
   */
  reset(): void {
    this.sites = [];
    this.sitePermissions = [];
    this.failPermissionWrite = false;
    this.nextId = 1;
  }

  mintSiteId(): string {
    return `site-${this.nextId++}`;
  }
}

const PGRST116 = { code: "PGRST116", message: "No rows found" };

interface QueryState {
  table: string;
  filters: Array<[string, unknown]>;
  op: "select" | "insert" | "upsert";
  payload: Record<string, unknown> | null;
}

function matches(row: object, filters: QueryState["filters"]) {
  const columns = row as Record<string, unknown>;
  return filters.every(([column, value]) => columns[column] === value);
}

function runQuery(db: FakeDb, state: QueryState) {
  if (state.op === "insert" && state.table === "sites") {
    const payload = state.payload as { domain: string; name: string };

    // `domain` carries a UNIQUE constraint in 20250817000000_complete_database_setup.sql.
    if (db.sites.some((site) => site.domain === payload.domain)) {
      return {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "sites_domain_key"',
        },
      };
    }

    const row: SiteRow = {
      id: db.mintSiteId(),
      domain: payload.domain,
      name: payload.name,
      created_at: "2026-08-07T00:00:00.000Z",
      api_key: "raw-api-key",
    };
    db.sites.push(row);
    return { data: row, error: null };
  }

  if (
    (state.op === "insert" || state.op === "upsert") &&
    state.table === "site_permissions"
  ) {
    if (db.failPermissionWrite) {
      // Nothing is written — exactly what a failed statement leaves behind.
      return {
        data: null,
        error: { code: "57014", message: "canceling statement due to timeout" },
      };
    }

    const payload = state.payload as unknown as PermissionRow;
    db.sitePermissions.push({ ...payload });
    return { data: payload, error: null };
  }

  if (state.op === "select") {
    const source: object[] =
      state.table === "sites" ? db.sites : db.sitePermissions;
    const found = source.filter((row) => matches(row, state.filters));
    return found.length > 0
      ? { data: found[0], error: null }
      : { data: null, error: PGRST116 };
  }

  throw new Error(`unsupported query: ${state.op} on ${state.table}`);
}

type Settled = ReturnType<typeof runQuery>;

/**
 * The chainable stand-in for a PostgREST builder. Annotated explicitly because
 * every method returns the object itself, which TypeScript cannot infer from a
 * self-referential initializer (TS7022).
 */
interface FakeQueryBuilder {
  select(): FakeQueryBuilder;
  eq(column: string, value: unknown): FakeQueryBuilder;
  insert(payload: Record<string, unknown>): FakeQueryBuilder;
  upsert(payload: Record<string, unknown>): FakeQueryBuilder;
  single(): Promise<Settled>;
  then(
    onFulfilled: (value: Settled) => unknown,
    onRejected: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

function makeServiceClient(db: FakeDb) {
  return {
    from(table: string) {
      const state: QueryState = {
        table,
        filters: [],
        op: "select",
        payload: null,
      };

      const builder: FakeQueryBuilder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          state.op = "upsert";
          state.payload = payload;
          return builder;
        },
        single() {
          return Promise.resolve(runQuery(db, state));
        },
        // PostgREST builders are thenable; the route awaits the upsert directly.
        then(onFulfilled, onRejected) {
          return Promise.resolve(runQuery(db, state)).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return builder;
    },
  };
}

const db = new FakeDb();

const mockGetUser = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({ auth: { getUser: mockGetUser } }),
  ),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => makeServiceClient(db)),
}));

// Not under test here, and each has its own suite. Neither can hide the
// atomicity defect: they run entirely before the first write.
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

jest.mock("@/lib/feature-gating/permissions", () => ({
  canCreateWebsite: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return { ...actual, buildSiteToken: jest.fn(() => "signed-site-token") };
});

import { POST } from "@/app/api/sites/register/route";

const DOMAIN = "orphan.example.com";

function register(domain = DOMAIN): Promise<Response> {
  return POST(
    new NextRequest("https://www.recopyfa.st/api/sites/register", {
      method: "POST",
      body: JSON.stringify({ domain, name: "Orphan Co" }),
    }),
  ) as unknown as Promise<Response>;
}

describe("A-11 POST /api/sites/register leaves an orphan site on permission failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.reset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("writes both rows when nothing fails (control)", async () => {
    const response = await register();

    expect(response.status).toBe(200);
    expect(db.sites).toHaveLength(1);
    expect(db.sitePermissions).toEqual([
      { site_id: "site-1", user_id: "user-123", permission: "admin" },
    ]);
  });

  // Guard for the rollback case below. `test.failing` passes on *any* throw,
  // including a broken mock, so this asserts the same path reaches the
  // permission write and reports it — proving the failure below is the route's
  // behaviour and not a defect in this file.
  it("reports the permission failure (guard for the rollback case)", async () => {
    db.failPermissionWrite = true;

    const response = await register();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to assign site permissions");
  });

  test.failing(
    "rolls the site row back when the permission write fails",
    async () => {
      db.failPermissionWrite = true;

      await register();

      // The 500 is the right answer. The `sites` row surviving it is not:
      // no user can see it, and no user can remove it.
      expect(db.sitePermissions).toHaveLength(0);
      expect(db.sites.filter((site) => site.domain === DOMAIN)).toHaveLength(0);
    },
  );

  // Guard for the lockout case below: the duplicate-domain refusal is real and
  // reachable after a *successful* registration, which is correct behaviour.
  // The case below shows the same refusal firing after a failed one.
  it("refuses a domain that is genuinely registered (guard for the lockout case)", async () => {
    const first = await register();
    expect(first.status).toBe(200);

    const duplicate = await register();
    const body = await duplicate.json();

    expect(duplicate.status).toBe(400);
    expect(body.error).toBe("Domain already registered");
  });

  test.failing(
    "does not lock the customer out of their own domain after a failed attempt",
    async () => {
      db.failPermissionWrite = true;
      await register();

      // The transient failure is over; the same customer retries.
      db.failPermissionWrite = false;
      const retry = await register();
      const body = await retry.json();

      expect(body.error).not.toBe("Domain already registered");
      expect(retry.status).toBe(200);
      expect(db.sitePermissions).toEqual([
        expect.objectContaining({ user_id: "user-123", permission: "admin" }),
      ]);
    },
  );
});
