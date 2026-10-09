/**
 * s77 (s42 review m3, s44 review m2, ADR 056) — a site holds at most
 * MAX_API_KEYS_PER_SITE keys, and a key's name is bounded.
 *
 * `/api/v1/content` meters per key (s44), so with no cap N keys gave a site N
 * times the ceiling — the per-site bound ADR 002 §4 exists for was gone. The
 * eleventh key is a 409 before anything is written; the count is per SITE,
 * across every admin, active or paused (a paused key resumes without a create),
 * read through the service client after the admin check because the SELECT
 * policy shows a user only their own keys. A count the database cannot give is
 * a refusal, never a pass.
 *
 * `name` was unbounded `TEXT`; over MAX_API_KEY_NAME_LENGTH is a 400 before
 * the permission read.
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  MAX_API_KEYS_PER_SITE,
  MAX_API_KEY_NAME_LENGTH,
} from "@/lib/api/api-key-limits";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

import { POST } from "@/app/api/api-keys/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";

let keysOnSite = 0;
let countError: { message: string } | null = null;
let countFilters: Array<[string, unknown]> = [];
let inserts: unknown[] = [];
let permissionReads = 0;

function userClient() {
  return {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = async () => {
        if (table === "site_permissions") {
          permissionReads += 1;
          return { data: { permission: "admin" }, error: null };
        }
        return { data: null, error: { message: "unexpected" } };
      };
      return builder;
    },
  };
}

function serviceClient() {
  return {
    from: () => {
      let isCount = false;
      const filters: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {};
      builder.select = (_columns?: string, options?: { head?: boolean }) => {
        if (options?.head) isCount = true;
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        if (isCount) countFilters = filters;
        return builder;
      };
      builder.insert = (rows: unknown[]) => {
        inserts.push(...rows);
        return builder;
      };
      builder.single = async () => ({
        data: { id: "key-1", site_id: SITE_ID, name: "k" },
        error: null,
      });
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          countError
            ? { data: null, count: null, error: countError }
            : { data: null, count: keysOnSite, error: null },
        ).then(resolve);
      return builder;
    },
  };
}

function createKey(name: string): NextRequest {
  return new NextRequest("http://localhost/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: SITE_ID, name }),
  });
}

describe("POST /api/api-keys — per-site key cap and name bound", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    keysOnSite = 0;
    countError = null;
    countFilters = [];
    inserts = [];
    permissionReads = 0;
    (createClient as jest.Mock).mockResolvedValue(userClient());
    (createServiceRoleClient as jest.Mock).mockReturnValue(serviceClient());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("caps a site at 10 keys and a name at 100 characters", () => {
    expect(MAX_API_KEYS_PER_SITE).toBe(10);
    expect(MAX_API_KEY_NAME_LENGTH).toBe(100);
  });

  it("refuses the eleventh key on a site with 409 and writes nothing", async () => {
    keysOnSite = MAX_API_KEYS_PER_SITE;

    const response = await POST(createKey("Staging"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      `This site already has ${MAX_API_KEYS_PER_SITE} API keys, the most a site can hold. Delete one before creating another.`,
    );
    expect(inserts).toHaveLength(0);
  });

  it("counts every key on the site, whoever created it", async () => {
    keysOnSite = MAX_API_KEYS_PER_SITE;

    await POST(createKey("Staging"));

    expect(countFilters).toEqual([["site_id", SITE_ID]]);
  });

  it("creates the tenth key", async () => {
    keysOnSite = MAX_API_KEYS_PER_SITE - 1;

    const response = await POST(createKey("Staging"));

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(1);
  });

  it("refuses rather than creates when the count fails", async () => {
    countError = { message: "connection reset" };

    const response = await POST(createKey("Staging"));

    expect(response.status).toBe(500);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a name over the bound with 400, before the permission read", async () => {
    const response = await POST(
      createKey("n".repeat(MAX_API_KEY_NAME_LENGTH + 1)),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      `Key name must be at most ${MAX_API_KEY_NAME_LENGTH} characters.`,
    );
    expect(permissionReads).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  // Devin on PR #82: the bound was measured on what the caller typed, but
  // sanitizing HTML-encodes it, so 100 `<` were stored as 400 characters.
  it("refuses a name whose stored, encoded form exceeds the bound", async () => {
    const response = await POST(createKey("<".repeat(MAX_API_KEY_NAME_LENGTH)));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      `Key name must be at most ${MAX_API_KEY_NAME_LENGTH} characters.`,
    );
    expect(permissionReads).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("accepts a name exactly at the bound", async () => {
    const response = await POST(createKey("n".repeat(MAX_API_KEY_NAME_LENGTH)));

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(1);
  });
});
