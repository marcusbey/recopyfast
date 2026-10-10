/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

type Row = Record<string, unknown> | null;

const state: {
  key: Row;
  admin: Row;
  adminError: { message: string } | null;
  permissionQueries: Array<Record<string, unknown>>;
} = { key: null, admin: null, adminError: null, permissionQueries: [] };

function apiKeysTable() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      state.key
        ? { data: state.key, error: null }
        : { data: null, error: { message: "no rows" } },
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  return chain;
}

function sitePermissionsTable() {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () => {
      state.permissionQueries.push({ ...filters });
      return { data: state.admin, error: state.adminError };
    },
  };
  return chain;
}

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    from: (table: string) =>
      table === "api_keys" ? apiKeysTable() : sitePermissionsTable(),
  }),
}));

import { validateAPIKey } from "../rate-limiter";

const activeKey = {
  id: "key-1",
  user_id: "user-1",
  site_id: "site-1",
  scopes: ["read", "write"],
  is_active: true,
  expires_at: null,
  rate_limit_per_minute: 60,
};

function request() {
  return new NextRequest("https://www.recopyfa.st/api/v1/content", {
    headers: { authorization: "Bearer rcf_live_plaintext" },
  });
}

describe("validateAPIKey — the creator must still administer the site", () => {
  beforeEach(() => {
    state.key = { ...activeKey };
    state.admin = { user_id: "user-1" };
    state.adminError = null;
    state.permissionQueries = [];
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a key whose creator is still an admin of its site", async () => {
    const result = await validateAPIKey(request());

    expect(result.valid).toBe(true);
    expect(result.apiKey?.site_id).toBe("site-1");
    expect(state.permissionQueries).toEqual([
      { user_id: "user-1", site_id: "site-1", permission: "admin" },
    ]);
  });

  it("refuses a key once its creator is no longer an admin (s42 review M1)", async () => {
    state.admin = null;

    const result = await validateAPIKey(request());

    expect(result).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("refuses when the admin check itself fails", async () => {
    state.adminError = { message: "connection reset" };

    const result = await validateAPIKey(request());

    expect(result.valid).toBe(false);
  });

  it("refuses a key that is not bound to a site", async () => {
    state.key = { ...activeKey, site_id: null };

    const result = await validateAPIKey(request());

    expect(result).toEqual({ valid: false, error: "Invalid API key" });
    expect(state.permissionQueries).toEqual([]);
  });
});
