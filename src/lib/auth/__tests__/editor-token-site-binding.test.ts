/**
 * @jest-environment node
 */

/*
 * s40 review major: once AI spend is charged to the site's owner, the only
 * thing stopping an edit-session or staging token issued for site A from
 * charging site B's owner is the `site_id` filter in each lookup. Every stub in
 * the suite ignored filters, so deleting either one left 391 and 446 tests
 * green. This fake applies every `.eq()` it is given, so a lookup that forgets
 * the site finds site A's row from site B and these tests go red.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateEditorAccess } from "../editor-access";
import { StagingAccessManager } from "../staging-access";

jest.mock("@/lib/supabase/service");

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const tables: Record<string, Array<Record<string, unknown>>> = {
  edit_sessions: [
    {
      id: "session-a",
      token: "edit-token-a",
      site_id: "site-a",
      is_active: true,
      expires_at: FUTURE,
      permissions: ["view", "edit"],
    },
  ],
  staging_access: [
    {
      id: "access-a",
      token: "staging-token-a",
      site_id: "site-a",
      is_active: true,
      expires_at: FUTURE,
      // An unverified invite: the lookup's result is visible without
      // stubbing device binding — found → valid + unverified, missing →
      // "Invalid or expired staging token".
      access_type: "email",
      email: "bob@example.com",
      email_verified: false,
      permissions: ["view", "edit"],
    },
  ],
};

function filteringClient() {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
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
        is: () => chain,
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

describe("editing tokens are bound to the site they were issued for", () => {
  beforeEach(() => {
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        filteringClient() as unknown as ReturnType<
          typeof createServiceRoleClient
        >,
      );
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts site A's edit session on site A", async () => {
    const result = await validateEditorAccess({
      siteId: "site-a",
      token: { kind: "edit-session", token: "edit-token-a" },
    });

    expect(result.valid).toBe(true);
  });

  it("refuses site A's edit session on site B", async () => {
    const result = await validateEditorAccess({
      siteId: "site-b",
      token: { kind: "edit-session", token: "edit-token-a" },
    });

    expect(result.valid).toBe(false);
  });

  it("finds site A's staging link on site A", async () => {
    const result = await StagingAccessManager.validateStagingAccess(
      "staging-token-a",
      "site-a",
    );

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("refuses site A's staging link on site B", async () => {
    const result = await StagingAccessManager.validateStagingAccess(
      "staging-token-a",
      "site-b",
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid or expired staging token");
  });
});
