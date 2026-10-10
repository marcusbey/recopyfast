const mockIs = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: mockIs }),
      }),
    }),
  })),
}));

import { listSitesForEditor } from "../editor-directory";

describe("listSitesForEditor", () => {
  beforeEach(() => {
    mockIs.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws when the read fails instead of reporting an empty list", async () => {
    // s39 review M1: an empty list is rendered as "No sites yet … isn't set up
    // to edit anything", which tells a real editor they were removed.
    mockIs.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    await expect(listSitesForEditor("bob@example.com")).rejects.toThrow(
      /site list failed/,
    );
  });

  it("returns the editor's live sites sorted by name", async () => {
    mockIs.mockResolvedValue({
      data: [
        {
          id: "e2",
          site_id: "s2",
          permissions: ["edit"],
          sites: { id: "s2", name: "Zeta", domain: "zeta.example" },
        },
        {
          id: "e1",
          site_id: "s1",
          permissions: ["edit", "publish"],
          sites: { id: "s1", name: "Alpha", domain: "alpha.example" },
        },
        { id: "e3", site_id: "s3", permissions: ["edit"], sites: null },
      ],
      error: null,
    });

    const sites = await listSitesForEditor("bob@example.com");

    expect(sites.map((site) => site.siteName)).toEqual(["Alpha", "Zeta"]);
  });
});
