/**
 * A-9 — collaborator sharing writes `site_permissions` with a user-scoped
 * client.
 *
 * `src/app/api/sites/[siteId]/share/route.ts:48` builds the anon-key client and
 * `:198-209` inserts the new permission row through it.
 *
 * WHICH MIGRATION IS LIVE DECIDES WHICH WAY THIS BREAKS (B-3 / T-2)
 * ----------------------------------------------------------------
 * The database is unreachable from the repo, so the deployed policy set is
 * unknown. Two branches, decided by whether `20260731008000` is applied:
 *
 *   Branch A — `20260731008000_rls_policies_for_locked_tables.sql:110-116` is
 *     live. It creates `FOR INSERT TO authenticated WITH CHECK
 *     (user_has_site_permission(site_id, ARRAY['admin']))`, so the insert
 *     succeeds. Invites work — and A-4 is fully armed, because the same
 *     migration adds the site-scoped DELETE policy that lets a `manager`
 *     collaborator remove the owner's row.
 *
 *   Branch B — only `20260804130000_restore_missing_rls_policies.sql:71-80` is
 *     live. It restores SELECT-for-self and FOR ALL to `service_role` and
 *     nothing else, so `authenticated` has no INSERT policy, the write matches
 *     zero rows, `.select().single()` returns PGRST116 and the route 500s.
 *     Every collaborator invite fails and no customer can add a teammate.
 *
 * THE INVARIANT ASSERTED HERE HOLDS UNDER EITHER BRANCH: sharing a site with a
 * user must leave a readable `site_permissions` row behind. Only one
 * implementation satisfies that on both branches — writing with the
 * service-role client, which both migrations grant FOR ALL. The route already
 * builds one, for `resolveUserIdentity` (`:23`), so the shape of the fix is
 * present in the file.
 *
 * Assertions are on the row that ends up in the table, not on the status code.
 */

import fs from "fs";
import path from "path";

import { NextRequest } from "next/server";

import { POST } from "@/app/api/sites/[siteId]/share/route";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CollaborationPermissions } from "@/lib/collaboration/permissions";
import { canShareSite } from "@/lib/feature-gating/permissions";

jest.mock("@/lib/supabase/server", () => ({ createServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/feature-gating/permissions", () => ({
  canShareSite: jest.fn(),
}));
jest.mock("@/lib/collaboration/permissions", () => ({
  CollaborationPermissions: jest.fn(),
  // The real mapping: "manager" -> "admin". Stubbing it would hide what a
  // shared `manager` seat actually grants.
  teamRoleToSitePermission: jest.requireActual(
    "@/lib/collaboration/permissions",
  ).teamRoleToSitePermission,
}));

const mockCreateServerClient = createServerClient as jest.MockedFunction<
  typeof createServerClient
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockCanShareSite = canShareSite as jest.MockedFunction<
  typeof canShareSite
>;
const MockPermissions = CollaborationPermissions as jest.MockedClass<
  typeof CollaborationPermissions
>;

const SITE_ID = "site-123";
const ADMIN_ID = "owner-1";
const INVITEE_ID = "teammate-1";

/**
 * The rows the request touches, shared by both clients so "was it written"
 * means the same thing whichever client did the writing.
 */
interface Store {
  sites: Array<Record<string, unknown>>;
  site_permissions: Array<Record<string, unknown>>;
  collaboration_notifications: Array<Record<string, unknown>>;
}

function newStore(): Store {
  return {
    sites: [{ id: SITE_ID, name: "Example", domain: "example.com" }],
    site_permissions: [
      {
        id: "perm-creator",
        site_id: SITE_ID,
        user_id: ADMIN_ID,
        team_id: null,
        permission: "admin",
        granted_by: null,
      },
    ],
    collaboration_notifications: [],
  };
}

/**
 * A PostgREST-shaped client over `store`.
 *
 * `writesRefused` is how branch B is expressed: an RLS-blocked INSERT is not an
 * exception, it is a write that matches zero rows, which supabase-js surfaces
 * as PGRST116 from `.single()`. That distinction is the whole reason the route
 * 500s rather than logging something legible.
 */
function makeClient(
  store: Store,
  options: { writesRefused?: boolean; label: string },
) {
  const writes: Array<{ table: string; by: string }> = [];

  function from(table: keyof Store) {
    const filters: Array<[string, unknown]> = [];
    let pending:
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null = null;
    let isInsert = false;

    const matching = () =>
      (store[table] ?? []).filter((row) =>
        filters.every(([column, value]) => row[column] === value),
      );

    const commit = () => {
      if (!isInsert) return matching();
      if (options.writesRefused) return [];

      const inserted = (Array.isArray(pending) ? pending : [pending]).map(
        (row, index) => ({ id: `${table}-new-${index}`, ...row }),
      ) as Array<Record<string, unknown>>;

      store[table] = [...store[table], ...inserted];
      writes.push({ table, by: options.label });
      return inserted;
    };

    const resolve = (one: boolean) => {
      const rows = commit();
      if (!one) return Promise.resolve({ data: rows, error: null });
      return Promise.resolve(
        rows[0]
          ? { data: rows[0], error: null }
          : {
              data: null,
              error: { code: "PGRST116", message: "no rows returned" },
            },
      );
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        isInsert = true;
        pending = payload;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      single: () => resolve(true),
      maybeSingle: () => resolve(true),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        resolve(false).then(onOk, onErr),
    };

    return builder;
  }

  return { from, writes };
}

function shareRequest(): NextRequest {
  return new NextRequest(
    `https://app.recopyfast.test/api/sites/${SITE_ID}/share`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: INVITEE_ID, role: "manager" }),
    },
  );
}

const context = { params: Promise.resolve({ siteId: SITE_ID }) };

/**
 * Run the share request against a given policy branch.
 *
 * Both clients read and write the same store; only the user-scoped one is
 * subject to `writesRefused`, which is exactly the asymmetry the two migrations
 * create.
 */
async function share(branch: "A" | "B") {
  const store = newStore();

  const user = makeClient(store, {
    writesRefused: branch === "B",
    label: "user",
  });
  const service = makeClient(store, { label: "service" });

  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: jest
        .fn()
        .mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null }),
    },
    from: user.from,
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);

  mockCreateServiceRoleClient.mockReturnValue({
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: INVITEE_ID,
              email: "teammate@corp.example",
              user_metadata: { name: "Teammate" },
            },
          },
          error: null,
        }),
      },
    },
    from: service.from,
  } as unknown as ReturnType<typeof createServiceRoleClient>);

  await POST(shareRequest(), context);

  return {
    store,
    writes: [...user.writes, ...service.writes],
    grantedRow: store.site_permissions.find(
      (row) => row.user_id === INVITEE_ID,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});

  mockCanShareSite.mockResolvedValue({ allowed: true } as Awaited<
    ReturnType<typeof canShareSite>
  >);
  MockPermissions.mockImplementation(
    () =>
      ({
        checkSitePermission: jest
          .fn()
          .mockResolvedValue({ hasPermission: true }),
      }) as unknown as CollaborationPermissions,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-9 — POST /api/sites/:siteId/share", () => {
  it("records the collaborator when the user client may write (branch A)", async () => {
    // The control. Under the branch where `20260731008000` is live the feature
    // works, which is why nothing in the current suite catches this — and it is
    // also the branch where A-4 is exploitable.
    const { grantedRow } = await share("A");

    expect(grantedRow).toMatchObject({
      site_id: SITE_ID,
      user_id: INVITEE_ID,
      permission: "admin",
      role: "manager",
    });
  });

  it("runs the share handler to completion under branch B", async () => {
    // Guard for the assertion below. It reads a row out of the store, and an
    // absent row is also what a handler that 401'd on a broken auth mock, or
    // threw before reaching the insert, would leave behind — `test.failing`
    // cannot tell those apart from "RLS refused the write". This proves the
    // request was authorised, got past the seat check, and left the fixture
    // intact; only the new row is in dispute.
    const { store } = await share("B");

    expect(store.site_permissions.some((row) => row.user_id === ADMIN_ID)).toBe(
      true,
    );
    expect(store.sites).toHaveLength(1);
  });

  test.failing(
    "records the collaborator when the user client may not write (branch B)",
    async () => {
      // The invariant. Adding a teammate is a primary journey; it must not
      // depend on which of two migrations reached production.
      const { grantedRow } = await share("B");

      expect(grantedRow).toMatchObject({
        site_id: SITE_ID,
        user_id: INVITEE_ID,
        permission: "admin",
      });
    },
  );

  it("records exactly one site_permissions write under branch A", async () => {
    // Guard for the assertion below, which pins both the count and the client.
    // An empty `writes` array would fail that assertion for the wrong reason —
    // "nothing wrote" rather than "the wrong client wrote".
    const { writes } = await share("A");

    expect(
      writes.filter((write) => write.table === "site_permissions"),
    ).toHaveLength(1);
  });

  test.failing(
    "writes the permission row with a client both branches permit",
    async () => {
      // The mechanism behind the failure above, stated so a fix is unambiguous:
      // `service_role` is granted FOR ALL in both `20260731008000` and
      // `20260804130000`, so it is the only client under which this write is
      // policy-independent.
      const { writes } = await share("A");

      const permissionWrites = writes.filter(
        (write) => write.table === "site_permissions",
      );

      expect(permissionWrites).toEqual([
        { table: "site_permissions", by: "service" },
      ]);
    },
  );
});

// ---------------------------------------------------------------------------
// The migration-level branch, checkable without a database
// ---------------------------------------------------------------------------

/** The identifier the share route issues its `site_permissions` insert through. */
function insertClientIdentifier(): string | null {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/sites/[siteId]/share/route.ts"),
    "utf8",
  );

  const insertBlock = routeSource.match(
    /(\w+)\s*\n?\s*\.from\("site_permissions"\)\s*\n?\s*\.insert\(/,
  );

  return insertBlock?.[1] ?? null;
}

/** Does the migration recorded as applied grant `authenticated` the insert? */
const APPLIED_MIGRATION_PATH =
  "supabase/migrations/20260804130000_restore_missing_rls_policies.sql";

function appliedMigrationGrantsInsert(): boolean {
  const appliedMigration = fs.readFileSync(
    path.join(process.cwd(), APPLIED_MIGRATION_PATH),
    "utf8",
  );

  return [
    ...appliedMigration.matchAll(
      /CREATE POLICY\s+"[^"]+"\s+ON\s+site_permissions\b([\s\S]*?);/gi,
    ),
  ].some(
    (policy) =>
      /FOR\s+(INSERT|ALL)/i.test(policy[1]) &&
      /TO\s+authenticated/i.test(policy[1]),
  );
}

describe("A-9 — the INSERT path is policy-independent", () => {
  it("locates the insert statement and the applied migration", () => {
    // Guard for the disjunction below. Both halves of it are `false` when the
    // sources cannot be read or the patterns stop matching, so a refactor of
    // the route — or a renamed migration — would keep the assertion red and
    // look like an unfixed defect long after it was fixed.
    expect(insertClientIdentifier()).not.toBeNull();
    expect(typeof appliedMigrationGrantsInsert()).toBe("boolean");
    // The applied migration does contain policies on this table; the question
    // is only which commands they cover.
    expect(
      fs.readFileSync(path.join(process.cwd(), APPLIED_MIGRATION_PATH), "utf8"),
    ).toContain("ON site_permissions");
  });

  test.failing(
    "either the route uses service_role, or the applied migration grants the insert",
    () => {
      // A disjunction on purpose: both fixes are legitimate, and pinning one
      // would make this test fail on a correct implementation of the other.
      //
      // `20260804130000` is the migration recorded as applied to production;
      // `20260731008000` is the one whose status is unknown (B-3). If the route
      // keeps writing with the user client, the applied migration has to carry
      // the policy — and it does not.
      const routeUsesServiceRole = /service/i.test(
        insertClientIdentifier() ?? "",
      );

      expect(routeUsesServiceRole || appliedMigrationGrantsInsert()).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// The live-database branch (gated)
// ---------------------------------------------------------------------------

/**
 * Gated, not skipped by hand: set `RCF_TEST_DB_URL` to a Postgres URL — a local
 * `supabase start` instance, or production once `SUPABASE_PASSWORD` is rotated
 * (T-2) — and this runs. Without it the block is inert.
 *
 * NOT a `test.failing`, because its outcome is the unknown itself. Read it as
 * the branch oracle:
 *   GREEN  -> branch A. Invites work today and A-4 is armed. Fix A-4 first.
 *   RED    -> branch B. Every collaborator invite is 500ing in production now.
 *
 * NOTE: `src/__tests__/db/db-harness.ts` is the shared home for this pattern
 * and reads the same variable. It is deliberately not imported here — it is
 * still being written by another workstream, and a top-level import would load
 * it on every run of this file including the gated-off one. Fold this block in
 * once that API settles; the harness also auto-detects a local Supabase from
 * `supabase/config.toml`, which this narrower gate does not.
 *
 * This block is the ONE thing in this file that has not been executed: no
 * database was reachable (B-3).
 */
const DB_URL = process.env.RCF_TEST_DB_URL;
const describeWithDb = DB_URL ? describe : describe.skip;

/**
 * `pg` ships no type declarations and `@types/pg` is not a dependency of this
 * repo — adding one would be a package.json change, which is out of scope here.
 * Declaring the three members this block actually uses keeps `tsc --noEmit`
 * clean without a new dependency. The same shape is declared in
 * `share-owner-lockout.test.ts`; hoist both into
 * `src/__tests__/db/db-harness.ts` when this folds in.
 */
interface PgQueryResult<Row> {
  rows: Row[];
}

interface PgClient {
  connect(): Promise<void>;
  query<Row>(sql: string): Promise<PgQueryResult<Row>>;
  end(): Promise<void>;
}

interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

interface PolicyRow {
  policyname: string;
}

const INSERT_POLICY_SQL = `SELECT policyname
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'site_permissions'
      AND cmd        IN ('INSERT', 'ALL')
      AND 'authenticated' = ANY(roles)`;

/**
 * Held in a variable rather than written inline: a literal specifier makes
 * TypeScript resolve `pg`'s own (absent) declarations and raise TS7016 before
 * the cast below can apply. A non-literal specifier yields `any`, which the
 * cast then narrows to the interface above.
 */
const PG_MODULE = "pg";

async function readAuthenticatedInsertPolicies(): Promise<PolicyRow[]> {
  const pg: unknown = await import(PG_MODULE);
  const { Client } = pg as PgModule;
  const client = new Client({ connectionString: DB_URL as string });
  await client.connect();

  try {
    const { rows } = await client.query<PolicyRow>(INSERT_POLICY_SQL);
    return rows;
  } finally {
    await client.end();
  }
}

describeWithDb("A-9 — the deployed policy set", () => {
  it("can read pg_policies for site_permissions", async () => {
    // Guard for the oracle below: a dead connection or a bad SQL string would
    // otherwise read as "branch B", which is a live production incident. The
    // branch call is only trustworthy once the query is known to run.
    const rows = await readAuthenticatedInsertPolicies();

    expect(Array.isArray(rows)).toBe(true);
  });

  it("permits the insert the share route actually issues", async () => {
    const rows = await readAuthenticatedInsertPolicies();

    expect(rows.map((row) => row.policyname)).not.toEqual([]);
  });
});
