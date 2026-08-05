import {
  authorizeFirstPartyEditorAccess,
  extractEditorToken,
  normalizePermissions,
  requireEditorPermission,
} from "../editor-access";

const mockCreateClient = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

describe("editor access helpers", () => {
  describe("normalizePermissions", () => {
    it("expands admin into view, edit, publish, and admin", () => {
      expect(normalizePermissions(["admin"])).toEqual([
        "view",
        "edit",
        "publish",
        "admin",
      ]);
    });

    it("expands edit into view and edit only", () => {
      expect(normalizePermissions(["edit"])).toEqual(["view", "edit"]);
    });

    it("keeps explicit publish access without granting admin", () => {
      expect(normalizePermissions(["publish"])).toEqual([
        "view",
        "edit",
        "publish",
      ]);
    });
  });

  describe("requireEditorPermission", () => {
    const access = {
      kind: "edit-session" as const,
      siteId: "site-123",
      token: "token-123",
      permissions: normalizePermissions(["publish"]),
      verified: true,
    };

    it("accepts implied permissions", () => {
      expect(requireEditorPermission(access, "view")).toBe(true);
      expect(requireEditorPermission(access, "edit")).toBe(true);
      expect(requireEditorPermission(access, "publish")).toBe(true);
    });

    it("rejects permissions not present after normalization", () => {
      expect(requireEditorPermission(access, "admin")).toBe(false);
    });
  });

  describe("extractEditorToken", () => {
    it("prefers staging token parameters", () => {
      const request = new Request(
        "https://site.example/?rcf_staging=1&rcf_token=staging-token&rcf_edit_token=edit-token",
      );

      expect(extractEditorToken(request, { siteId: "site-123" })).toEqual({
        kind: "staging",
        token: "staging-token",
      });
    });

    it("supports compatibility edit-token parameters", () => {
      const request = new Request(
        "https://site.example/?rcf_edit_token=edit-token",
      );

      expect(extractEditorToken(request, { siteId: "site-123" })).toEqual({
        kind: "edit-session",
        token: "edit-token",
      });
    });

    it("supports JSON body aliases", () => {
      expect(
        extractEditorToken(new Request("https://site.example/"), {
          siteId: "site-123",
          editToken: "edit-token",
        }),
      ).toEqual({
        kind: "edit-session",
        token: "edit-token",
      });
    });
  });

  describe("authorizeFirstPartyEditorAccess", () => {
    /**
     * Builds a stub whose `from("site_permissions")` returns `row`, and records
     * the table it was asked for so a test can assert WHICH client did the read.
     */
    function stubClient({
      user,
      row,
    }: {
      user: { id: string; email: string } | null;
      row: { permission: string } | null;
    }) {
      const tables: string[] = [];
      const client = {
        auth: { getUser: async () => ({ data: { user } }) },
        from: (table: string) => {
          tables.push(table);
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({ data: row }),
          };
          return chain;
        },
      };
      return { client, tables };
    }

    beforeEach(() => {
      mockCreateClient.mockReset();
    });

    it("refuses a caller with no session", async () => {
      const { client } = stubClient({ user: null, row: null });
      mockCreateClient.mockResolvedValue(client);

      await expect(
        authorizeFirstPartyEditorAccess("site-123", "edit"),
      ).resolves.toBeNull();
    });

    it("refuses a signed-in user with no permission row for the site", async () => {
      const { client } = stubClient({
        user: { id: "user-1", email: "someone@example.com" },
        row: null,
      });
      mockCreateClient.mockResolvedValue(client);

      await expect(
        authorizeFirstPartyEditorAccess("site-123", "edit"),
      ).resolves.toBeNull();
    });

    it("grants an admin the edit permission admin implies", async () => {
      const { client } = stubClient({
        user: { id: "owner-1", email: "owner@example.com" },
        row: { permission: "admin" },
      });
      mockCreateClient.mockResolvedValue(client);

      const access = await authorizeFirstPartyEditorAccess("site-123", "edit");

      expect(access).not.toBeNull();
      expect(access?.userId).toBe("owner-1");
      expect(access?.email).toBe("owner@example.com");
      expect(access?.permissions).toEqual(["view", "edit", "publish", "admin"]);
      // Session-carried access has no bearer token to replay.
      expect(access?.token).toBe("");
    });

    it("refuses a viewer asking to publish", async () => {
      const { client } = stubClient({
        user: { id: "viewer-1", email: "viewer@example.com" },
        row: { permission: "view" },
      });
      mockCreateClient.mockResolvedValue(client);

      await expect(
        authorizeFirstPartyEditorAccess("site-123", "publish"),
      ).resolves.toBeNull();
    });

    /**
     * The register's central lesson: "the tests mock Supabase, and the mock has
     * no row-level security", so a permissions read done with the service role
     * would pass every test here and still fail in production the moment
     * `site_permissions` lost its policy — which is exactly what F-2/F-3 were.
     * The mock cannot enforce RLS, so this asserts the one thing it can: that
     * the read goes through the request-scoped client, which RLS applies to.
     */
    it("reads site_permissions through the caller's own client", async () => {
      const { client, tables } = stubClient({
        user: { id: "owner-1", email: "owner@example.com" },
        row: { permission: "admin" },
      });
      mockCreateClient.mockResolvedValue(client);

      await authorizeFirstPartyEditorAccess("site-123", "view");

      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      expect(tables).toEqual(["site_permissions"]);
    });
  });
});
