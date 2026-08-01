import {
  extractEditorToken,
  normalizePermissions,
  requireEditorPermission,
} from "../editor-access";

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
});
