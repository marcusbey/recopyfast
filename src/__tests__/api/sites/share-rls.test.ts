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

import { DELETE, GET, POST } from "@/app/api/sites/[siteId]/share/route";
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
const GRANTED_PERMISSION_ID = "perm-teammate";

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
 * Branch B is expressed by two options, because the restrictive policy set
 * restricts two different things and each one breaks a different handler:
 *
 *   `writesRefused`   — an RLS-blocked INSERT or DELETE is not an exception, it
 *                       is a statement that matches zero rows, which supabase-js
 *                       surfaces as PGRST116 from `.single()`. That distinction
 *                       is why POST 500s rather than logging something legible.
 *
 *   `selfOnlyUserId`  — `20260804130000` restores SELECT only for
 *                       `user_id = auth.uid()`, so the caller's client can read
 *                       its OWN permission row and no other. This is what makes
 *                       GET return a one-row collaborator list and makes the
 *                       DELETE pre-read answer "Permission not found" for
 *                       everyone but yourself.
 */
function makeClient(
  store: Store,
  options: {
    writesRefused?: boolean;
    selfOnlyUserId?: string;
    label: string;
  },
) {
  const writes: Array<{ table: string; by: string }> = [];

  function from(table: keyof Store) {
    const filters: Array<[string, unknown]> = [];
    let pending:
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null = null;
    let isInsert = false;
    let isDelete = false;

    const matching = () => {
      const rows = (store[table] ?? []).filter((row) =>
        filters.every(([column, value]) => row[column] === value),
      );

      // The SELECT-for-self policy applies to site_permissions only.
      if (options.selfOnlyUserId && table === "site_permissions") {
        return rows.filter((row) => row.user_id === options.selfOnlyUserId);
      }
      return rows;
    };

    const commit = () => {
      if (isInsert) {
        if (options.writesRefused) return [];

        const inserted = (Array.isArray(pending) ? pending : [pending]).map(
          (row, index) => ({ id: `${table}-new-${index}`, ...row }),
        ) as Array<Record<string, unknown>>;

        store[table] = [...store[table], ...inserted];
        writes.push({ table, by: options.label });
        return inserted;
      }

      if (isDelete) {
        // A DELETE is subject to the same visibility as a SELECT: it can only
        // remove rows the policy lets this role see.
        const doomed = options.writesRefused ? [] : matching();
        if (doomed.length > 0) {
          store[table] = store[table].filter((row) => !doomed.includes(row));
          writes.push({ table, by: options.label });
        }
        return doomed;
      }

      return matching();
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
      delete: () => {
        isDelete = true;
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
    selfOnlyUserId: branch === "B" ? ADMIN_ID : undefined,
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

/**
 * The role the caller holds on the site, for the run in progress.
 *
 * `checkSitePermission` is mocked role-aware rather than always-true: it answers
 * from this value against the roles each handler asks for, which is what the real
 * implementation does. A blanket `hasPermission: true` cannot tell a handler that
 * admits viewers from one that admits only managers, so it would pass whatever
 * the authz line happened to be — including a widening.
 */
let callerRole: "viewer" | "editor" | "manager" | "owner" = "owner";

/** Every user id the route asked the Admin API to resolve, in order. */
const identityLookups: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});

  callerRole = "owner";
  identityLookups.length = 0;
  mockCanShareSite.mockResolvedValue({ allowed: true } as Awaited<
    ReturnType<typeof canShareSite>
  >);
  MockPermissions.mockImplementation(
    () =>
      ({
        checkSitePermission: jest
          .fn()
          .mockImplementation((_userId, _siteId, allowedRoles: string[]) =>
            Promise.resolve({
              hasPermission: allowedRoles.includes(callerRole),
              userRole: callerRole,
            }),
          ),
      }) as unknown as CollaborationPermissions,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The rest of the collaborator lifecycle, under the same two branches
// ---------------------------------------------------------------------------

/** A store that already holds the invitee, so listing and revoking have a subject. */
function storeWithCollaborator(): Store {
  const store = newStore();
  store.site_permissions = [
    ...store.site_permissions,
    {
      id: GRANTED_PERMISSION_ID,
      site_id: SITE_ID,
      user_id: INVITEE_ID,
      team_id: null,
      permission: "admin",
      role: "manager",
      granted_by: ADMIN_ID,
    },
  ];
  return store;
}

/** Wire both clients over one store, as `share()` does. */
function wireClients(store: Store, branch: "A" | "B") {
  const user = makeClient(store, {
    writesRefused: branch === "B",
    selfOnlyUserId: branch === "B" ? ADMIN_ID : undefined,
    label: "user",
  });
  const service = makeClient(store, { label: "service" });

  const getUserById = jest.fn().mockImplementation((userId: string) => {
    identityLookups.push(userId);
    return Promise.resolve({
      data: {
        user: {
          id: userId,
          email: `${userId}@corp.example`,
          user_metadata: { name: userId },
        },
      },
      error: null,
    });
  });

  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: jest
        .fn()
        .mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null }),
    },
    from: user.from,
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);

  mockCreateServiceRoleClient.mockReturnValue({
    auth: { admin: { getUserById } },
    from: service.from,
  } as unknown as ReturnType<typeof createServiceRoleClient>);

  return { user, service };
}

interface ListedPermission {
  id: string;
  user_id: string | null;
  user: { email: string } | null;
}

async function listCollaborators(branch: "A" | "B") {
  const store = storeWithCollaborator();
  wireClients(store, branch);

  const response = await GET(
    new NextRequest(`https://app.recopyfast.test/api/sites/${SITE_ID}/share`),
    context,
  );

  return {
    status: response.status,
    permissions: ((await response.json()).permissions ??
      []) as ListedPermission[],
  };
}

async function revokeCollaborator(branch: "A" | "B") {
  const store = storeWithCollaborator();
  wireClients(store, branch);

  const response = await DELETE(
    new NextRequest(
      `https://app.recopyfast.test/api/sites/${SITE_ID}/share?permissionId=${GRANTED_PERMISSION_ID}`,
      { method: "DELETE" },
    ),
    context,
  );

  return {
    status: response.status,
    body: await response.json(),
    remaining: store.site_permissions.map((row) => row.id),
  };
}

describe("A-9 — GET /api/sites/:siteId/share", () => {
  it("lists every collaborator under branch A", async () => {
    // The control: with a permissive SELECT policy the caller's own client can
    // see the whole list, which is why this path looked fine.
    const { status, permissions } = await listCollaborators("A");

    expect(status).toBe(200);
    expect(permissions.map((row) => row.id).sort()).toEqual(
      ["perm-creator", GRANTED_PERMISSION_ID].sort(),
    );
  });

  it("lists every collaborator under branch B", async () => {
    // The invariant, and the half the first pass at this fix missed. Moving only
    // the writes to the service role left an owner who could add a teammate and
    // then not see them: SELECT-for-self returns exactly one row, their own.
    const { status, permissions } = await listCollaborators("B");

    expect(status).toBe(200);
    expect(permissions.map((row) => row.id).sort()).toEqual(
      ["perm-creator", GRANTED_PERMISSION_ID].sort(),
    );
  });

  it("resolves each listed collaborator's identity", async () => {
    // Guard against the list being "complete" but empty of identities, which is
    // what an unresolvable embed produced before A-12.
    const { permissions } = await listCollaborators("B");

    const invitee = permissions.find((row) => row.user_id === INVITEE_ID);
    expect(invitee?.user?.email).toBe(`${INVITEE_ID}@corp.example`);
  });

  // Reading the roster service-scoped means the response now carries every
  // collaborator's email address, resolved through the Admin API. That is a
  // management view, so the reader has to be narrowed to match — otherwise
  // fixing the list turned it into an address-harvesting endpoint for anyone
  // with view access.
  it.each([["viewer"], ["editor"]] as const)(
    "refuses a %s the decorated roster",
    async (role) => {
      callerRole = role;

      const { status, permissions } = await listCollaborators("B");

      expect(status).toBe(403);
      expect(permissions).toEqual([]);
    },
  );

  it.each([["manager"], ["owner"]] as const)(
    "serves a %s the full decorated roster",
    async (role) => {
      callerRole = role;

      const { status, permissions } = await listCollaborators("B");

      expect(status).toBe(200);
      expect(permissions.map((row) => row.id).sort()).toEqual(
        ["perm-creator", GRANTED_PERMISSION_ID].sort(),
      );
      expect(
        permissions.find((row) => row.user_id === INVITEE_ID)?.user?.email,
      ).toBe(`${INVITEE_ID}@corp.example`);
    },
  );

  it("does not resolve any identity for a refused caller", async () => {
    // The stronger form of the 403 above: a rejected request must not have
    // reached the Admin API at all. A handler that authorised late — decorating
    // first and checking afterwards — would still leak through logs, latency and
    // whatever the next refactor does with the already-fetched rows.
    callerRole = "viewer";
    const store = storeWithCollaborator();
    wireClients(store, "B");

    await GET(
      new NextRequest(`https://app.recopyfast.test/api/sites/${SITE_ID}/share`),
      context,
    );

    expect(identityLookups).toEqual([]);
  });
});

describe("A-9 — DELETE /api/sites/:siteId/share", () => {
  it("revokes the collaborator under branch A", async () => {
    const { status, remaining } = await revokeCollaborator("A");

    expect(status).toBe(200);
    expect(remaining).toEqual(["perm-creator"]);
  });

  it("revokes the collaborator under branch B", async () => {
    // Under SELECT-for-self the pre-read could not see the row being revoked, so
    // this answered 404 and the seat could never be reclaimed — the owner pays
    // for a collaborator they cannot remove.
    const { status, body, remaining } = await revokeCollaborator("B");

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(remaining).toEqual(["perm-creator"]);
  });

  it("still refuses a permissionId belonging to another site", async () => {
    // The service role removes RLS as a backstop, so the site scoping in the
    // handler is now the only thing standing between a guessed id and a
    // cross-site revoke. It has to hold on its own.
    const store = storeWithCollaborator();
    store.site_permissions = [
      ...store.site_permissions,
      {
        id: "perm-other-site",
        site_id: "site-elsewhere",
        user_id: "someone-else",
        team_id: null,
        permission: "admin",
      },
    ];
    wireClients(store, "A");

    const response = await DELETE(
      new NextRequest(
        `https://app.recopyfast.test/api/sites/${SITE_ID}/share?permissionId=perm-other-site`,
        { method: "DELETE" },
      ),
      context,
    );

    expect(response.status).toBe(404);
    expect(store.site_permissions.map((row) => row.id)).toContain(
      "perm-other-site",
    );
  });
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

  it("records the collaborator when the user client may not write (branch B)", async () => {
    // The invariant. Adding a teammate is a primary journey; it must not
    // depend on which of two migrations reached production.
    const { grantedRow } = await share("B");

    expect(grantedRow).toMatchObject({
      site_id: SITE_ID,
      user_id: INVITEE_ID,
      permission: "admin",
    });
  });

  it("records exactly one site_permissions write under branch A", async () => {
    // Guard for the assertion below, which pins both the count and the client.
    // An empty `writes` array would fail that assertion for the wrong reason —
    // "nothing wrote" rather than "the wrong client wrote".
    const { writes } = await share("A");

    expect(
      writes.filter((write) => write.table === "site_permissions"),
    ).toHaveLength(1);
  });

  it("writes the permission row with a client both branches permit", async () => {
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
  });
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

  it("either the route uses service_role, or the applied migration grants the insert", () => {
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
  });
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
