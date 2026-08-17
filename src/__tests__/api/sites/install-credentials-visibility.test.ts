/**
 * Regression guard for `728b646` — install credentials are not a membership
 * perk.
 *
 * `GET /api/sites` used to hand every caller who could see a site a freshly
 * minted 90-day site token and a ready-to-paste embed snippet. A site token
 * authenticates the widget's own write paths, so a viewer or an editor who was
 * given one held a credential the owner never meant to issue and cannot see to
 * revoke.
 *
 * The fix gates both on `permission === 'admin'`. s14a adds a third principal
 * to the content write path, which makes "who is handed an install credential"
 * a question worth pinning down rather than re-deriving: a grant holder is an
 * *editor*, has no `site_permissions` row at all, and must never come out of
 * this endpoint holding a site token.
 */

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({ auth: { getUser: mockGetUser } }),
  ),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

import { GET } from "@/app/api/sites/route";
import { NextRequest } from "next/server";

const USER_ID = "user-1";
const SITE_ID = "site-1";

interface SiteRow {
  id: string;
  domain: string;
  name: string;
  created_at: string;
  updated_at: string;
  api_key: string | null;
}

const SITE: SiteRow = {
  id: SITE_ID,
  domain: "helloworld.example",
  name: "Hello World",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  api_key: "the-hmac-secret",
};

/** Answers the handful of reads this route makes, by table. */
function installTables(permission: string) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "site_permissions") {
      return {
        select: () => ({
          eq: async () => ({
            data: [{ site_id: SITE_ID, permission }],
            error: null,
          }),
        }),
      };
    }

    if (table === "sites") {
      return {
        select: () => ({
          in: async () => ({ data: [SITE], error: null }),
        }),
      };
    }

    // content_elements / content_history — counts only, uninteresting here.
    return {
      select: () => ({
        eq: async () => ({ data: [], count: 0, error: null }),
        in: () => ({
          order: () => ({
            limit: () => ({ single: async () => ({ data: null }) }),
          }),
        }),
      }),
    };
  });
}

async function listSites() {
  const response = (await GET(
    new NextRequest("https://www.recopyfa.st/api/sites"),
  )) as unknown as Response;
  return response.json();
}

describe("GET /api/sites — install credentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  });

  afterEach(() => jest.restoreAllMocks());

  it("gives an admin the site token and the embed snippet", async () => {
    installTables("admin");

    const body = await listSites();
    const site = body.sites[0];

    expect(site.siteToken).toEqual(expect.any(String));
    expect(site.embedScript).toContain("data-site-token=");
  });

  it("gives an editor neither", async () => {
    installTables("edit");

    const body = await listSites();
    const site = body.sites[0];

    expect(site.siteToken).toBeUndefined();
    expect(site.embedScript).toBeUndefined();
    // And no back door: the HMAC secret the token is minted from must not be
    // in the response either.
    expect(JSON.stringify(body)).not.toContain(SITE.api_key);
  });

  it("gives a viewer neither", async () => {
    installTables("view");

    const body = await listSites();
    const site = body.sites[0];

    expect(site.siteToken).toBeUndefined();
    expect(site.embedScript).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SITE.api_key);
  });

  it("still refuses a caller with no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    installTables("admin");

    const response = (await GET(
      new NextRequest("https://www.recopyfa.st/api/sites"),
    )) as unknown as Response;

    expect(response.status).toBe(401);
  });
});
