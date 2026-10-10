/**
 * s68a (ADR 047, rule 3) — removing a member deactivates their edit sessions.
 *
 * H1, survival half: `DELETE /api/sites/[siteId]/share` deleted the member's
 * `site_permissions` row and never touched `edit_sessions`, so a removed
 * member's session lived on until it expired. Since s68a the validator reads
 * the holder's live grant on every request, so that session already
 * AUTHORISES nothing once the row is gone — this deactivation is not the
 * security control. It is what makes the dashboard's session list and the
 * realtime sweep tell the truth immediately instead of at expiry.
 *
 * So: the update runs only after the grant is actually deleted, through the
 * service client (the only writer of `edit_sessions`), scoped by `site_id`
 * AND the removed row's `user_id`; a team row (no `user_id`) touches no
 * session; and a failed update is logged without turning a completed removal
 * into an error.
 */

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

const SITE_ID = "site-123";
const OWNER_ID = "owner-1";
const MEMBER_ID = "member-1";

const CREATOR_ROW = {
  id: "perm-creator",
  site_id: SITE_ID,
  user_id: OWNER_ID,
  team_id: null,
  permission: "admin",
  granted_by: null,
};
const MEMBER_ROW = {
  id: "perm-member",
  site_id: SITE_ID,
  user_id: MEMBER_ID,
  team_id: null,
  permission: "edit",
  granted_by: OWNER_ID,
};
const TEAM_ROW = {
  id: "perm-team",
  site_id: SITE_ID,
  user_id: null,
  team_id: "team-1",
  permission: "edit",
  granted_by: OWNER_ID,
};
const ROWS: Array<Record<string, unknown>> = [
  CREATOR_ROW,
  MEMBER_ROW,
  TEAM_ROW,
];

interface Op {
  client: "user" | "service";
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/** One log across both clients, so the ORDER of the delete and the update is visible. */
function makeClient(
  label: Op["client"],
  ops: Op[],
  options: { failSessionUpdate?: boolean } = {},
) {
  function from(table: string) {
    const op: Op = { client: label, table, kind: "select", filters: [] };
    const matching = () =>
      table === "site_permissions"
        ? ROWS.filter((row) =>
            op.filters.every(([column, value]) => row[column] === value),
          )
        : [];

    const resolve = (one: boolean) => {
      ops.push(op);
      if (
        op.kind === "update" &&
        table === "edit_sessions" &&
        options.failSessionUpdate
      ) {
        return Promise.resolve({
          data: null,
          error: { message: "connection reset" },
        });
      }
      if (op.kind !== "select") {
        return Promise.resolve({ data: null, error: null });
      }
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
      insert: (payload: Record<string, unknown>) => {
        op.kind = "insert";
        op.payload = payload;
        return resolve(false);
      },
      update: (payload: Record<string, unknown>) => {
        op.kind = "update";
        op.payload = payload;
        return builder;
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

  return { from };
}

function install(options: { failSessionUpdate?: boolean } = {}) {
  const ops: Op[] = [];
  jest.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: jest
        .fn()
        .mockResolvedValue({ data: { user: { id: OWNER_ID } }, error: null }),
    },
    ...makeClient("user", ops),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue(
      makeClient("service", ops, options) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );
  return ops;
}

function revoke(permissionId: string) {
  return DELETE(
    new NextRequest(
      `https://app.recopyfast.test/api/sites/${SITE_ID}/share?permissionId=${permissionId}`,
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

const sessionUpdates = (ops: Op[]) =>
  ops.filter((op) => op.table === "edit_sessions" && op.kind === "update");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(CollaborationPermissions).mockImplementation(
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

describe("s68a — DELETE /api/sites/:siteId/share deactivates the removed member's edit sessions", () => {
  it("after the grant is deleted, the service client deactivates that member's sessions on this site", async () => {
    const ops = install();

    const response = await revoke(MEMBER_ROW.id);

    expect(response.status).toBe(200);
    const updates = sessionUpdates(ops);
    expect(updates).toEqual([
      expect.objectContaining({
        client: "service",
        payload: { is_active: false, revoked_at: expect.any(String) },
      }),
    ]);
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ["site_id", SITE_ID],
        ["user_id", MEMBER_ID],
      ]),
    );
    const grantDelete = ops.findIndex(
      (op) => op.table === "site_permissions" && op.kind === "delete",
    );
    expect(grantDelete).toBeGreaterThan(-1);
    expect(ops.indexOf(updates[0])).toBeGreaterThan(grantDelete);
  });

  it("guard: removing a team row (no user_id) touches no edit session", async () => {
    const ops = install();

    const response = await revoke(TEAM_ROW.id);

    expect(response.status).toBe(200);
    expect(sessionUpdates(ops)).toEqual([]);
  });

  it("a failed deactivation is logged and the completed removal still answers 200", async () => {
    install({ failSessionUpdate: true });

    const response = await revoke(MEMBER_ROW.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Site access revoked successfully",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("edit sessions"),
      expect.anything(),
    );
  });
});
