/**
 * A-11 (deletion half) — DELETE /api/sites/[siteId] used to destroy ownership
 * first.
 *
 * The route deleted every `site_permissions` row for the site, then deleted the
 * `sites` row as a separate statement. If the second one failed the first was
 * already committed, and the two halves disagreed in the worst possible
 * direction:
 *
 *   - the customer could no longer see the site (the `sites` SELECT policy
 *     authorises through `site_permissions`, which was now empty), so they could
 *     neither retry the delete nor edit it;
 *   - the widget kept serving its content, because the widget authorises on
 *     the site token, not on permissions.
 *
 * The site was live on the public internet and nobody owned it.
 *
 * Order is the fix, not atomicity: the route now deletes `sites` alone and lets
 * `site_permissions.site_id`'s ON DELETE CASCADE take the rest, so a failure
 * leaves every row where it was — the ownership row included.
 *
 * Two of these were `test.failing` markers and are now enforced. They depended on
 * 20260809130000_content_history_definer_and_delete_split.sql landing in the same
 * branch: until it did, the single `sites` delete this file now requires could not
 * succeed at all against a real database for any site holding content (A-35).
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
  granted_by: string | null;
}

const SITE_ID = "site-1";
const OWNER_ID = "user-123";

class FakeDb {
  sites: SiteRow[] = [];
  sitePermissions: PermissionRow[] = [];
  /** Simulates the site delete failing. */
  failSiteDelete = false;
  /** Every table the route issued a DELETE against, in order. */
  deletes: string[] = [];
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
    db.deletes.push(state.table);

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

      // `site_permissions.site_id REFERENCES sites(id) ON DELETE CASCADE`
      // (20250817000000_complete_database_setup.sql:55). The route relies on that
      // cascade instead of issuing a second statement, so the double has to model
      // it — otherwise the control case below would demand a delete the schema
      // already performs, and the reordering this file is about could not be
      // expressed at all.
      const doomed = db.sites.filter((row) => matches(row, state.filters));
      const doomedIds = new Set(doomed.map((row) => row.id));
      db.sites = db.sites.filter((row) => !doomedIds.has(row.id));
      db.sitePermissions = db.sitePermissions.filter(
        (row) => !doomedIds.has(row.site_id),
      );
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
      {
        site_id: SITE_ID,
        user_id: OWNER_ID,
        permission: "admin",
        granted_by: null,
      },
    ];
    db.failSiteDelete = false;
    db.deletes = [];
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

  it("keeps the caller's ownership row when the site delete fails", async () => {
    db.failSiteDelete = true;

    await deleteSite();

    // The site is still there, so the permission that authorises it must be
    // too — otherwise nobody can see, retry or manage a site that is still
    // being served to the public.
    expect(db.sites).toHaveLength(1);
    expect(db.sitePermissions).toEqual([
      {
        site_id: SITE_ID,
        user_id: OWNER_ID,
        permission: "admin",
        granted_by: null,
      },
    ]);
  });

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

  it("lets the owner retry a failed deletion", async () => {
    db.failSiteDelete = true;
    await deleteSite();

    // Whatever broke the first attempt is fixed; the owner tries again.
    db.failSiteDelete = false;
    const retry = await deleteSite();

    // The permission check at :26-38 is the gate. While ownership was destroyed
    // first it answered 403 "Site not found or insufficient permissions" here,
    // and the site row could never be removed by anyone.
    expect(retry.status).toBe(200);
    expect(db.sites).toHaveLength(0);
  });

  // The reordering IS the fix, so pin the order itself and not only its
  // consequences. A future change that reintroduces an explicit
  // `site_permissions` delete before the `sites` delete would restore the defect
  // while both cases above still passed, because a run in which nothing fails
  // cannot tell the two orders apart.
  it("deletes only sites, and leaves site_permissions to the cascade", async () => {
    const response = await deleteSite();

    expect(response.status).toBe(200);
    // `site_permissions` is read once for the authorisation check at :26-31.
    // The only DELETE the route may issue is the one against `sites`.
    expect(db.deletes).toEqual(["sites"]);
  });
});

describe("DELETE /api/sites/[siteId] refuses invited managers", () => {
  const MANAGER_ID = "manager-456";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.sites = [{ id: SITE_ID, domain: "kept.example.com", name: "Kept Co" }];
    db.sitePermissions = [
      {
        site_id: SITE_ID,
        user_id: OWNER_ID,
        permission: "admin",
        granted_by: null,
      },
      {
        site_id: SITE_ID,
        user_id: MANAGER_ID,
        permission: "admin",
        granted_by: OWNER_ID,
      },
    ];
    db.failSiteDelete = false;
    db.deletes = [];
    mockGetUser.mockResolvedValue({
      data: { user: { id: MANAGER_ID } },
      error: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not let an invited manager delete the site", async () => {
    const response = await deleteSite();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/creator/i);
    expect(db.sites).toHaveLength(1);
    expect(db.deletes).toEqual([]);
  });
});
