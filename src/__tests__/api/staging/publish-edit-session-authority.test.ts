/**
 * s68a (ADR 047) — POST /api/staging/publish with an edit token and no cookie.
 *
 * This is the H1 exploit end to end through the shipped route: an `edit`
 * member mints an `admin` edit session (the INSERT policy let them), sends it
 * as `body.editToken` with no session cookie, and the route asks
 * `requireEditorPermission(access, "publish")` of the permissions the row
 * claims. It answered 200 and the copy went live.
 *
 * The fix lives in the shared validator (`validateEditSessionAccess`), not in
 * this route, so every edit-token route inherits it; the route file is
 * unchanged. Only the database, the limiter and the owner-plan gate are
 * stubbed; `authorizeFirstPartyEditorAccess`, `validateEditorTokenFromRequest`
 * and `requireEditorPermission` are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/server", () => ({
  // No cookie: the first-party branch finds no user and falls through to the
  // token path, which is the path H1 used.
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));
jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));
// The fixture's owner holds a plan (s51). The owner-plan gate itself is
// proved in src/__tests__/api/owner-plan-gate.test.ts.
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: () => Promise.resolve({ ok: true, ownerId: "owner-1" }),
}));

import { POST } from "@/app/api/staging/publish/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const HOUR_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

function session(token: string, userId: string, permissions: string[]): Row {
  return {
    id: `session-${token}`,
    token,
    site_id: SITE_ID,
    user_id: userId,
    permissions,
    is_active: true,
    created_at: new Date(Date.now() - HOUR_MS).toISOString(),
    expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
  };
}

const tables: Record<string, Row[]> = {
  edit_sessions: [
    session("edit-member-admin-row", "editor", ["admin"]),
    session("removed-member", "removed", ["admin"]),
    session("live-admin", "admin", ["admin"]),
  ],
  site_permissions: [
    { site_id: SITE_ID, user_id: "editor", permission: "edit" },
    { site_id: SITE_ID, user_id: "admin", permission: "admin" },
  ],
};

const rpc = jest.fn();

function filteringClient() {
  return {
    rpc,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () =>
        (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return chain;
        },
        single: async () => {
          const found = rows();
          return found.length === 1
            ? { data: found[0], error: null }
            : { data: null, error: { message: "no rows" } };
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: () => ({
          eq: () => ({ then: (resolve: (v: unknown) => void) => resolve({}) }),
        }),
      };
      return chain;
    },
  };
}

function publishWith(editToken: string) {
  return POST(
    new NextRequest("https://www.recopyfa.st/api/staging/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: SITE_ID, editToken }),
    }),
  );
}

describe("POST /api/staging/publish — an edit token publishes only on its holder's live grant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        filteringClient() as unknown as ReturnType<
          typeof createServiceRoleClient
        >,
      );
    rpc.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("an edit member's admin-stamped session is refused 403 and nothing is published", async () => {
    const response = await publishWith("edit-member-admin-row");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Publish permission required",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a removed member's session is refused 401 and nothing is published", async () => {
    const response = await publishWith("removed-member");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or expired edit session",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("guard: a live admin's session still publishes", async () => {
    const response = await publishWith("live-admin");

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "publish_staging_content_with_attributes_atomic",
      expect.objectContaining({ p_site_id: SITE_ID, p_published_by: "admin" }),
    );
  });
});
