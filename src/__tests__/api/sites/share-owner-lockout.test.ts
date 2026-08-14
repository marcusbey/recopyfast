/**
 * A-4 — a collaborator with `manager` can delete the owner's only proof of
 * ownership.
 *
 * `sites` has no owner column (`20250817000000_complete_database_setup.sql:16-23`)
 * and the dashboard derives the site list solely from `site_permissions`
 * (`src/app/api/sites/route.ts:22-25`). The creator's `site_permissions` row is
 * therefore the entire record that they own the site. Delete it and the owner
 * cannot read, edit, publish, manage editors, see analytics or re-share — every
 * authorisation helper in the codebase keys off that table — while the
 * collaborator, whose row survives, solely controls the tenant.
 *
 * WHICH MIGRATION IS LIVE DECIDES HOW BAD THIS IS (B-3 / T-2)
 * ----------------------------------------------------------
 * The database is unreachable from the repo, so the deployed policy set is
 * unknown. Two branches, decided by whether `20260731008000` is applied:
 *
 *   Branch A — `20260731008000_rls_policies_for_locked_tables.sql:125-130` is
 *     live. `site_permissions` has
 *     `FOR DELETE TO authenticated USING (user_has_site_permission(site_id,
 *     ARRAY['admin']))`. That authorises per SITE, not per ROW, so any admin —
 *     including a `manager` collaborator, which `teamRoleToSitePermission` maps
 *     to `admin` — may delete any row of that site including the creator's.
 *     Postgres consults only the DELETE policy's USING for a non-RETURNING
 *     delete, so the narrow SELECT policy does not shield it, and the attack
 *     runs straight against PostgREST with the collaborator's own JWT.
 *
 *   Branch B — only `20260804130000_restore_missing_rls_policies.sql:71-80` is
 *     live. `site_permissions` then has SELECT-for-self plus FOR ALL to
 *     `service_role` and no DELETE policy for `authenticated`, so the PostgREST
 *     path is refused outright. A-4 is not exploitable there — but A-9 is fully
 *     armed instead, because the collaborator invite in
 *     `sites/[siteId]/share/route.ts:198` writes with the user-scoped client and
 *     has no INSERT policy to write under.
 *
 * THE INVARIANT ASSERTED HERE HOLDS UNDER EITHER BRANCH:
 * a collaborator must not be able to remove the creator's row, and a site must
 * never be left with zero admins.
 *
 * WHAT IS FIXED, AND WHAT IS STILL OPEN
 * -------------------------------------
 * The creator's row is now protected in application code: the DELETE handler
 * refuses any target whose `granted_by IS NULL`. That guard arrived with A-9,
 * and not by coincidence — A-9 moved this route's `site_permissions` queries to
 * the service-role client so that collaborator invites and revokes work under
 * either policy set, which also removed the only thing that had been stopping
 * this attack on the HTTP path. Under branch B the pre-read used to run as the
 * caller and the SELECT-for-self policy hid the row, so the request 404'd; that
 * was an accident of a read policy, it never applied to the direct PostgREST
 * path, and it is gone now. The protection had to become deliberate.
 *
 * STILL OPEN: there is no last-admin count. Revoking the last *non-creator*
 * admin still leaves a site with one admin only because the creator's row cannot
 * be removed — nothing counts admins before revoking one, and the marker below
 * ("counts the remaining admins before revoking one") stays red for that reason.
 *
 * ALSO STILL OPEN, and outside application code entirely: under branch A the
 * site-scoped `FOR DELETE` policy authorises the same attack straight against
 * PostgREST with the collaborator's own JWT, where no handler runs and no guard
 * applies. The migration-level test below is the oracle for that.
 *
 * Assertions are on whether the DELETE was issued, not on the status code.
 */

import fs from "fs";
import path from "path";

import { NextRequest } from "next/server";

import { DELETE } from "@/app/api/sites/[siteId]/share/route";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CollaborationPermissions } from "@/lib/collaboration/permissions";

jest.mock("@/lib/supabase/server", () => ({ createServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/collaboration/permissions", () => ({
  CollaborationPermissions: jest.fn(),
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
const MockPermissions = CollaborationPermissions as jest.MockedClass<
  typeof CollaborationPermissions
>;

const SITE_ID = "site-123";
const OWNER_ID = "owner-1";
const COLLABORATOR_ID = "collab-1";

/**
 * The creator's row, as `sites/register/route.ts:137-147` writes it: permission
 * `admin`, and `granted_by` left null because nobody granted it. The share
 * route always sets `granted_by`, so null is the marker that separates the
 * creator from every collaborator.
 */
const CREATOR_ROW = {
  id: "perm-creator",
  site_id: SITE_ID,
  user_id: OWNER_ID,
  team_id: null,
  permission: "admin",
  role: null,
  granted_by: null,
};

/** A `manager` invite. `teamRoleToSitePermission("manager")` is `admin`. */
const COLLABORATOR_ADMIN_ROW = {
  id: "perm-collab",
  site_id: SITE_ID,
  user_id: COLLABORATOR_ID,
  team_id: null,
  permission: "admin",
  role: "manager",
  granted_by: OWNER_ID,
};

const VIEWER_ROW = {
  id: "perm-viewer",
  site_id: SITE_ID,
  user_id: "viewer-1",
  team_id: null,
  permission: "view",
  role: "viewer",
  granted_by: OWNER_ID,
};

interface Op {
  table: string;
  kind: "select" | "delete" | "insert";
  filters: Array<[string, unknown]>;
}

/**
 * A client over a fixed `site_permissions` table, wired as BOTH the caller's
 * client and the service-role client.
 *
 * One shared `ops` log on purpose. This file's assertions are about whether the
 * route issued a DELETE against a given row — see the header — and that question
 * has the same answer and the same consequence whichever client carried it.
 * Since A-9 the route reads and writes `site_permissions` through the
 * service-role client, so a fixture that only instrumented the caller's client
 * recorded nothing at all: every "no delete was issued" assertion passed, and the
 * finding read as fixed while the route was in fact crashing on an undefined
 * `.from`. A false green on a privilege-escalation test is worse than a red one.
 *
 * `single()` answers the route's targeted read; an unfiltered resolution
 * answers the "how many admins does this site have" query a fixed route would
 * need to make. Both are available so the tests below are about what the route
 * chooses to do, not about what the fixture allows.
 */
function makeClient(rows: Array<Record<string, unknown>>, callerId: string) {
  const ops: Op[] = [];

  function from(table: string) {
    const op: Op = { table, kind: "select", filters: [] };

    const matching = () =>
      rows.filter((row) =>
        op.filters.every(([column, value]) => row[column] === value),
      );

    const resolve = (one: boolean) => {
      ops.push(op);
      if (op.kind !== "select")
        return Promise.resolve({ data: null, error: null });
      const found = matching();
      return Promise.resolve(
        one
          ? {
              data: found[0] ?? null,
              error: found[0] ? null : { message: "not found" },
            }
          : { data: found, error: null },
      );
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: () => {
        op.kind = "insert";
        return resolve(false);
      },
      delete: () => {
        op.kind = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return builder;
      },
      single: () => resolve(true),
      maybeSingle: () => resolve(true),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        resolve(false).then(onOk, onErr),
    };

    return builder;
  }

  return {
    client: {
      auth: {
        getUser: jest
          .fn()
          .mockResolvedValue({ data: { user: { id: callerId } }, error: null }),
      },
      from,
    } as unknown as Awaited<ReturnType<typeof createServerClient>>,
    serviceClient: {
      auth: { admin: { getUserById: jest.fn() } },
      from,
    } as unknown as ReturnType<typeof createServiceRoleClient>,
    ops,
  };
}

/** Install both clients for one fixture and hand back the shared op log. */
function install(rows: Array<Record<string, unknown>>, callerId: string) {
  const { client, serviceClient, ops } = makeClient(rows, callerId);

  mockCreateServerClient.mockResolvedValue(client);
  mockCreateServiceRoleClient.mockReturnValue(serviceClient);

  return { ops };
}

/** Did the route actually issue a DELETE against this permission row? */
function deletedRowIds(ops: Op[]): unknown[] {
  return ops
    .filter((op) => op.kind === "delete" && op.table === "site_permissions")
    .flatMap((op) =>
      op.filters
        .filter(([column]) => column === "id")
        .map(([, value]) => value),
    );
}

function deleteRequest(permissionId: string): NextRequest {
  return new NextRequest(
    `https://app.recopyfast.test/api/sites/${SITE_ID}/share?permissionId=${permissionId}`,
    { method: "DELETE" },
  );
}

const context = { params: Promise.resolve({ siteId: SITE_ID }) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});

  // The collaborator holds `manager`, so the route's own permission check —
  // the only guard on this path — passes. That is the premise of the finding,
  // not a weakening of the test.
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

describe("A-4 — DELETE /api/sites/:siteId/share", () => {
  it("revokes an ordinary collaborator", async () => {
    // The control. If this did not delete, every assertion below would pass
    // for the trivial reason that the route deletes nothing at all.
    const { ops } = install(
      [CREATOR_ROW, COLLABORATOR_ADMIN_ROW, VIEWER_ROW],
      COLLABORATOR_ID,
    );

    await DELETE(deleteRequest(VIEWER_ROW.id), context);

    expect(deletedRowIds(ops)).toEqual([VIEWER_ROW.id]);
  });

  it("answers 403 rather than 404 when the target is the creator's row", async () => {
    // The distinction matters. A 404 was the old, accidental behaviour — the
    // caller's client could not see the row, so the route could not tell "no
    // such row" from "not that one". The guard knows the difference, and saying
    // so is what tells an owner their site is intact rather than missing.
    install([CREATOR_ROW, COLLABORATOR_ADMIN_ROW], COLLABORATOR_ID);

    const response = await DELETE(deleteRequest(CREATOR_ROW.id), context);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/creator/i);
  });

  /**
   * One guard per `test.failing` in this block.
   *
   * All three assert that NO delete was issued — and "no delete was issued" is
   * also exactly what a route that 401'd on a broken auth mock, threw on a
   * malformed request, or never ran at all would produce. Under `test.failing`
   * that silence would read as a confirmed guard. Each guard runs the same
   * fixture through the same handler and proves the route got as far as
   * reading the row it was asked to delete.
   */
  it.each([
    ["a collaborator targeting the creator's row", COLLABORATOR_ID],
    ["the owner targeting their own row", OWNER_ID],
  ])("reaches the target-row read for %s", async (_label, callerId) => {
    const { ops } = install(
      [CREATOR_ROW, COLLABORATOR_ADMIN_ROW, VIEWER_ROW],
      callerId,
    );

    await DELETE(deleteRequest(CREATOR_ROW.id), context);

    const targetRead = ops.find(
      (op) =>
        op.kind === "select" &&
        op.table === "site_permissions" &&
        op.filters.some(
          ([column, value]) => column === "id" && value === CREATOR_ROW.id,
        ),
    );

    expect(targetRead).toBeDefined();
  });

  it("does not let a collaborator delete the creator's row", async () => {
    const { ops } = install(
      [CREATOR_ROW, COLLABORATOR_ADMIN_ROW],
      COLLABORATOR_ID,
    );

    await DELETE(deleteRequest(CREATOR_ROW.id), context);

    // The creator's row must survive. Asserted on the write that was issued,
    // because under branch A the same call over PostgREST removes the row for
    // real and the owner has no way back — there is no owner column to recover
    // from and no admin surface to re-grant through.
    expect(deletedRowIds(ops)).toEqual([]);
  });

  it("does not let a site be left with no admin", async () => {
    // The creator is the only admin. Removing them leaves a site nobody can
    // administer, which no caller — collaborator or owner — should be able to
    // reach by accident.
    const { ops } = install([CREATOR_ROW, VIEWER_ROW], OWNER_ID);

    await DELETE(deleteRequest(CREATOR_ROW.id), context);

    expect(deletedRowIds(ops)).toEqual([]);
  });

  it("records the site_permissions queries the route makes", async () => {
    // Guard for the assertion below, which asks whether any query filtered on
    // `permission`. An empty op log — from a handler that never ran — answers
    // "no" just as convincingly as a handler that ran and never counted.
    const { ops } = install(
      [CREATOR_ROW, COLLABORATOR_ADMIN_ROW],
      COLLABORATOR_ID,
    );

    await DELETE(deleteRequest(CREATOR_ROW.id), context);

    const permissionQueries = ops.filter(
      (op) => op.kind === "select" && op.table === "site_permissions",
    );

    expect(permissionQueries.length).toBeGreaterThan(0);
  });

  it("counts the remaining admins before revoking one", async () => {
    // The mechanism behind both failures above: the route reads exactly one
    // row — the target — and never asks how many admins the site has left.
    // Nothing in `site_permissions` is consulted beyond `id` and `site_id`.
    const { ops } = install(
      [CREATOR_ROW, COLLABORATOR_ADMIN_ROW],
      COLLABORATOR_ID,
    );

    await DELETE(deleteRequest(CREATOR_ROW.id), context);

    const permissionQueries = ops.filter(
      (op) => op.kind === "select" && op.table === "site_permissions",
    );
    const askedAboutAdmins = permissionQueries.some((op) =>
      op.filters.some(([column]) => column === "permission"),
    );

    expect(askedAboutAdmins).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The migration-level branch, checkable without a database
// ---------------------------------------------------------------------------

interface MigrationPolicy {
  file: string;
  name: string;
  body: string;
}

/** Every `CREATE POLICY ... ON site_permissions` across the migration set. */
function sitePermissionPolicies(): MigrationPolicy[] {
  const migrationsDir = path.join(process.cwd(), "supabase/migrations");
  const found: MigrationPolicy[] = [];

  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    // The schema qualifier is optional. `ON site_permissions` and
    // `ON public.site_permissions` name the same table, and a migration written
    // the second way must not slip past this scan — the guard below only
    // asserts that *some* policy was found, so a partially missed set would
    // still look like a clean read.
    const policies = sql.matchAll(
      /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:[a-z_][a-z0-9_$]*\.)?site_permissions\b([\s\S]*?);/gi,
    );

    for (const policy of policies) {
      found.push({ file, name: policy[1], body: policy[2] });
    }
  }

  return found;
}

describe("A-4 — the DELETE policy on site_permissions", () => {
  it("can read the migration set and find policies on site_permissions", () => {
    // Guard for the assertion below. That test collects offenders and expects
    // an empty list — which is also what an unreadable directory or a regex
    // that stopped matching would produce. Under `test.failing` a silent
    // no-match would be indistinguishable from "the policy was fixed".
    const policies = sitePermissionPolicies();

    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some((policy) => /FOR\s+DELETE/i.test(policy.body))).toBe(
      true,
    );
  });

  it("authorises per row, not per site", () => {
    // This is the assertion that names the branch. Under branch B no matching
    // policy exists and the filter below is empty, so this passes; under
    // branch A the policy exists with a site-scoped predicate and it fails.
    // Whichever way it lands, it is the answer to "is 20260731008000 live?"
    // expressed as code rather than as a question in a document.
    const unguarded = sitePermissionPolicies()
      .filter((policy) => /FOR\s+DELETE/i.test(policy.body))
      .filter((policy) => !/TO\s+service_role/i.test(policy.body))
      // A per-row predicate has to mention the row's own owner. A predicate
      // that only names `site_id` says "anyone with rights on this site",
      // which is exactly the authorisation the finding abuses.
      .filter((policy) => !/user_id/i.test(policy.body))
      .map((policy) => `${policy.file}: ${policy.name}`);

    expect(unguarded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The live-database branch (gated)
// ---------------------------------------------------------------------------

/**
 * Gated, not skipped by hand: set `RCF_TEST_DB_URL` to a Postgres URL — a local
 * `supabase start` instance, or production once `SUPABASE_PASSWORD` is rotated
 * (T-2) — and this runs. Without it the block is inert, so `npm test` works on
 * a laptop with no database.
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
 * clean without a new dependency, and documents exactly how much of the driver
 * these tests lean on. The same shape is declared in `share-rls.test.ts`;
 * hoist both into `src/__tests__/db/db-harness.ts` when this folds in.
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

interface DeletePolicyRow {
  policyname: string;
  qual: string | null;
}

const DELETE_POLICY_SQL = `SELECT policyname, qual
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'site_permissions'
      AND cmd        = 'DELETE'
      AND NOT ('service_role' = ANY(roles))`;

/**
 * Held in a variable rather than written inline: a literal specifier makes
 * TypeScript resolve `pg`'s own (absent) declarations and raise TS7016 before
 * the cast below can apply. A non-literal specifier yields `any`, which the
 * cast then narrows to the interface above — so the driver is typed at the one
 * place it is used, and nowhere else in the repo has to care.
 */
const PG_MODULE = "pg";

async function readDeletePolicies(): Promise<DeletePolicyRow[]> {
  const pg: unknown = await import(PG_MODULE);
  const { Client } = pg as PgModule;
  const client = new Client({ connectionString: DB_URL as string });
  await client.connect();

  try {
    const { rows } = await client.query<DeletePolicyRow>(DELETE_POLICY_SQL);
    return rows;
  } finally {
    await client.end();
  }
}

describeWithDb("A-4 — the deployed policy set", () => {
  it("can read pg_policies for site_permissions", async () => {
    // Guard. `test.failing` treats a dead connection, a bad SQL string or a
    // missing driver as a confirmed defect, so the query has to be shown to
    // run before its result is allowed to mean anything.
    const rows = await readDeletePolicies();

    expect(Array.isArray(rows)).toBe(true);
  });

  test.failing(
    "has no site-scoped DELETE policy on site_permissions",
    async () => {
      const rows = await readDeletePolicies();

      // Branch B returns zero rows and passes. Branch A returns the
      // `user_has_site_permission(site_id, ARRAY['admin'])` policy and fails,
      // which settles the question the audit could not.
      const siteScoped = rows.filter((row) => !/user_id/i.test(row.qual ?? ""));
      expect(siteScoped.map((row) => row.policyname)).toEqual([]);
    },
  );
});
