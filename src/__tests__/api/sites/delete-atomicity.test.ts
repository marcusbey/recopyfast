/**
 * A-11 (deletion half) — DELETE /api/sites/[siteId] destroys ownership first.
 *
 * src/app/api/sites/[siteId]/route.ts:47-71 deletes every `site_permissions`
 * row for the site, then deletes the `sites` row as a separate statement. If
 * the second one fails the first is already committed, and the two halves
 * disagree in the worst possible direction:
 *
 *   - the customer can no longer see the site (the `sites` SELECT policy
 *     authorises through `site_permissions`, which is now empty), so they can
 *     neither retry the delete nor edit it;
 *   - the widget keeps serving its content, because the widget authorises on
 *     the site token, not on permissions.
 *
 * The site is live on the public internet and nobody owns it.
 *
 * Order matters here, not just atomicity: deleting `sites` first and letting
 * the FK cascade take the permissions would leave nothing behind on failure.
 *
 * `test.failing` — these pass while the bug is present and start failing once
 * deletion is made atomic or reordered.
 */

import { NextRequest } from "next/server";

interface SiteRow {
  id: string;
  domain: string;
  name: string;
}

interface PermissionRow {
  site_id: string;
  user_id: string;
  permission: string;
}

const SITE_ID = "site-1";
const OWNER_ID = "user-123";

class FakeDb {
  sites: SiteRow[] = [];
  sitePermissions: PermissionRow[] = [];
  /** Simulates the second statement failing after the first has committed. */
  failSiteDelete = false;
}

const PGRST116 = { code: "PGRST116", message: "No rows found" };

interface QueryState {
  table: string;
  filters: Array<[string, unknown]>;
  op: "select" | "delete";
}

function matches(row: object, filters: QueryState["filters"]) {
  const columns = row as Record<string, unknown>;
  return filters.every(([column, value]) => columns[column] === value);
}

function runQuery(db: FakeDb, state: QueryState) {
  if (state.op === "delete") {
    if (state.table === "sites") {
      if (db.failSiteDelete) {
        return {
          data: null,
          error: {
            code: "23503",
            message:
              'update or delete on table "sites" violates foreign key constraint',
          },
        };
      }
      db.sites = db.sites.filter((row) => !matches(row, state.filters));
      return { data: null, error: null };
    }

    db.sitePermissions = db.sitePermissions.filter(
      (row) => !matches(row, state.filters),
    );
    return { data: null, error: null };
  }

  const source: object[] =
    state.table === "sites" ? db.sites : db.sitePermissions;
  const found = source.filter((row) => matches(row, state.filters));
  return found.length > 0
    ? { data: found[0], error: null }
    : { data: null, error: PGRST116 };
}

type Settled = ReturnType<typeof runQuery>;

/**
 * The chainable stand-in for a PostgREST builder. Annotated explicitly because
 * every method returns the object itself, which TypeScript cannot infer from a
 * self-referential initializer (TS7022).
 */
interface FakeQueryBuilder {
  select(): FakeQueryBuilder;
  delete(): FakeQueryBuilder;
  eq(column: string, value: unknown): FakeQueryBuilder;
  single(): Promise<Settled>;
  then(
    onFulfilled: (value: Settled) => unknown,
    onRejected: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

function makeServiceClient(db: FakeDb) {
  return {
    from(table: string) {
      const state: QueryState = { table, filters: [], op: "select" };

      const builder: FakeQueryBuilder = {
        select() {
          return builder;
        },
        delete() {
          state.op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value]);
          return builder;
        },
        single() {
          return Promise.resolve(runQuery(db, state));
        },
        // The route awaits the delete builders directly.
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

import { DELETE } from "@/app/api/sites/[siteId]/route";

function deleteSite(): Promise<Response> {
  return DELETE(
    new NextRequest(`https://www.recopyfa.st/api/sites/${SITE_ID}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as unknown as Promise<Response>;
}

describe("A-11 DELETE /api/sites/[siteId] deletes ownership before the site", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.sites = [{ id: SITE_ID, domain: "kept.example.com", name: "Kept Co" }];
    db.sitePermissions = [
      { site_id: SITE_ID, user_id: OWNER_ID, permission: "admin" },
    ];
    db.failSiteDelete = false;
    mockGetUser.mockResolvedValue({
      data: { user: { id: OWNER_ID } },
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes both rows when nothing fails (control)", async () => {
    const response = await deleteSite();

    expect(response.status).toBe(200);
    expect(db.sites).toHaveLength(0);
    expect(db.sitePermissions).toHaveLength(0);
  });

  // Guard for the case below. `test.failing` passes on any throw, so this
  // pins that the same path actually reaches the `sites` delete and reports
  // its failure — the assertion below is then about stored state, not plumbing.
  it("reports the site delete failure (guard for the ownership case)", async () => {
    db.failSiteDelete = true;

    const response = await deleteSite();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to delete site");
  });

  test.failing(
    "keeps the caller's ownership row when the site delete fails",
    async () => {
      db.failSiteDelete = true;

      await deleteSite();

      // The site is still there, so the permission that authorises it must be
      // too — otherwise nobody can see, retry or manage a site that is still
      // being served to the public.
      expect(db.sites).toHaveLength(1);
      expect(db.sitePermissions).toEqual([
        { site_id: SITE_ID, user_id: OWNER_ID, permission: "admin" },
      ]);
    },
  );

  // Guard for the retry case below: the 403 gate is real and reachable once
  // ownership is gone. That is correct after a *successful* delete; the case
  // below shows the same gate firing after a *failed* one, where it is not.
  it("refuses a caller with no permission row (guard for the retry case)", async () => {
    db.sitePermissions = [];

    const response = await deleteSite();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Site not found or insufficient permissions");
  });

  test.failing("lets the owner retry a failed deletion", async () => {
    db.failSiteDelete = true;
    await deleteSite();

    // Whatever broke the first attempt is fixed; the owner tries again.
    db.failSiteDelete = false;
    const retry = await deleteSite();

    // The permission check at :26-38 is the gate. With ownership already gone
    // it answers 403 "Site not found or insufficient permissions", and the site
    // row can never be removed by anyone.
    expect(retry.status).toBe(200);
    expect(db.sites).toHaveLength(0);
  });
});
