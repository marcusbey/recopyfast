// Set before the imports below are evaluated: editor-crypto memoises the
// signing key on first use, and a grant has to be signed with the same key the
// validator will resolve.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  authorizeFirstPartyEditorAccess,
  extractEditorToken,
  normalizePermissions,
  requireEditorPermission,
  validateEditorAccess,
} from "../editor-access";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "../editor-crypto";
import type { DeviceContext } from "../editor-grants";
import { createServiceRoleClient } from "@/lib/supabase/service";

const mockCreateClient = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

jest.mock("@/lib/supabase/service");

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

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

  /**
   * A device grant is the third principal on the content write path, and it
   * travels in exactly one place.
   *
   * The header is not a style choice. A credential in a URL is a credential in
   * browser history, in the `Referer` sent to every third-party asset on the
   * customer's page, and in every access log between here and there — and this
   * one authorises writes to a live customer site. `staging_access` already
   * carries a bearer token in a hand-delivered URL; migration
   * `20260801100000_editor_access_2fa.sql` exists precisely because that entry
   * URL was decided to carry no secret. This must not reverse it.
   */
  describe("extractEditorToken — the device grant", () => {
    const GRANT = "rcfg1.a-device-grant";

    it("reads the grant from X-RCF-Editor-Grant", () => {
      const request = new Request("https://site.example/", {
        headers: { "X-RCF-Editor-Grant": GRANT },
      });

      expect(extractEditorToken(request, null)).toEqual({
        kind: "device-grant",
        token: GRANT,
      });
    });

    it("ignores a grant offered as a URL parameter", () => {
      const request = new Request(
        `https://site.example/?rcf_grant=${GRANT}&grant=${GRANT}`,
      );

      // No header, so there is no editor token at all — the query string is not
      // a channel this credential is allowed to arrive on.
      expect(extractEditorToken(request, null)).toBeNull();
    });

    it("ignores a grant offered in the JSON body", () => {
      const request = new Request("https://site.example/");

      expect(
        extractEditorToken(request, { grant: GRANT, deviceGrant: GRANT }),
      ).toBeNull();
    });

    it("prefers the grant header over the site token the same request already carries", () => {
      // The widget sends `Authorization: Bearer <SITE_TOKEN>` on the very
      // content requests that will now also carry a grant
      // (recopyfast.src.js hydrateStoredContent / startPolling). The Bearer
      // branch treats its value as a STAGING token, so without this ordering a
      // grant-carrying request is sent down the wrong validator and the site
      // token is asked to prove something it cannot.
      const request = new Request("https://site.example/", {
        headers: {
          Authorization: "Bearer site-token-abc",
          "X-RCF-Editor-Grant": GRANT,
        },
      });

      expect(extractEditorToken(request, null)).toEqual({
        kind: "device-grant",
        token: GRANT,
      });
    });

    it("prefers the grant header over a staging token in the query string", () => {
      const request = new Request(
        "https://site.example/?rcf_token=staging-token",
        { headers: { "X-RCF-Editor-Grant": GRANT } },
      );

      expect(extractEditorToken(request, null)).toEqual({
        kind: "device-grant",
        token: GRANT,
      });
    });

    it("falls through to the existing paths when the header is blank", () => {
      const request = new Request(
        "https://site.example/?rcf_token=staging-token",
        { headers: { "X-RCF-Editor-Grant": "   " } },
      );

      expect(extractEditorToken(request, null)).toEqual({
        kind: "staging",
        token: "staging-token",
      });
    });
  });

  /**
   * The point everything in s14a turns on.
   *
   * A device grant is only worth anything because it is pinned to the origin it
   * was minted on — that pin is what makes an exfiltrated grant useless from an
   * attacker's page. The pin lives inside `validateDeviceGrant` and needs a
   * `DeviceContext` built from the `Origin` header. The parameter is optional,
   * so nothing in the type system stops a caller omitting it, and an omitted
   * context is not a compile error, not a test failure and not a 500 — it would
   * be a silent, cross-site editing credential minted with our name on it.
   *
   * So the branch refuses outright when the context is missing. It never
   * defaults it, never synthesises an origin from the request URL, and never
   * reaches the database to find out.
   *
   * `validateDeviceGrant` is NOT mocked here: mocking the thing under
   * protection is exactly how a fail-open ships green. Only the Supabase client
   * beneath it is stubbed.
   */
  describe("validateEditorAccess — the device-grant branch", () => {
    const SITE_ID = "site-abc";
    const OTHER_SITE_ID = "site-xyz";
    const EDITOR_ID = "site-editor-1";
    const GRANT_ROW_ID = "grant-row-1";
    const MINTING_ORIGIN = "https://helloworld.example";
    const ATTACKER_ORIGIN = "https://evil.example";
    const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";

    function deviceAt(origin: string): DeviceContext {
      return { origin, userAgent: USER_AGENT, ip: null };
    }

    function makeGrant(overrides: Record<string, unknown> = {}) {
      return encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
        g: GRANT_ROW_ID,
        s: SITE_ID,
        o: hashOrigin(MINTING_ORIGIN),
        x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
        n: "nonce",
        ...overrides,
      });
    }

    /** Minimal PostgREST stand-in that always answers with `row`. */
    function stubServiceClient(row: unknown) {
      const from = () => {
        const builder: Record<string, unknown> = {
          select: () => builder,
          update: () => builder,
          eq: () => builder,
          is: () => builder,
          maybeSingle: async () => ({ data: row, error: null }),
          single: async () => ({ data: row, error: null }),
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve({ data: row, error: null }).then(onOk),
        };
        return builder;
      };
      return { from } as unknown as ReturnType<typeof createServiceRoleClient>;
    }

    function grantRow(grant: string, overrides: Record<string, unknown> = {}) {
      return {
        id: GRANT_ROW_ID,
        site_editor_id: EDITOR_ID,
        grant_hash: hashOpaqueSecret(grant),
        user_agent_hash: hashUserAgent(USER_AGENT),
        origin_hash: hashOrigin(MINTING_ORIGIN),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        revoked_at: null,
        revoked_reason: null,
        site_editors: {
          id: EDITOR_ID,
          site_id: SITE_ID,
          email: "bob@corp.example",
          permissions: ["edit"],
          revoked_at: null,
        },
        ...overrides,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();
      resetSigningKeyCache();
      jest.spyOn(console, "warn").mockImplementation(() => {});
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("refuses a grant when no device context was derived, without reading anything", async () => {
      const grant = makeGrant();
      mockCreateServiceRoleClient.mockReturnValue(
        stubServiceClient(grantRow(grant)),
      );

      const result = await validateEditorAccess({
        siteId: SITE_ID,
        token: { kind: "device-grant", token: grant },
        // deviceContext deliberately absent — this is the whole test.
      });

      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      // Refused before the lookup: the absence of an origin is the answer, not
      // something to be resolved against the database.
      expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
    });

    it("refuses a grant replayed from an origin it was not minted on", async () => {
      const grant = makeGrant();
      mockCreateServiceRoleClient.mockReturnValue(
        stubServiceClient(grantRow(grant)),
      );

      const result = await validateEditorAccess({
        siteId: SITE_ID,
        token: { kind: "device-grant", token: grant },
        deviceContext: deviceAt(ATTACKER_ORIGIN),
      });

      expect(result).toMatchObject({
        valid: false,
        status: 401,
        error: "origin_mismatch",
      });
    });

    it("refuses a grant minted for another site", async () => {
      const grant = makeGrant({ s: OTHER_SITE_ID });
      mockCreateServiceRoleClient.mockReturnValue(
        stubServiceClient(grantRow(grant)),
      );

      const result = await validateEditorAccess({
        siteId: SITE_ID,
        token: { kind: "device-grant", token: grant },
        deviceContext: deviceAt(MINTING_ORIGIN),
      });

      expect(result).toMatchObject({
        valid: false,
        status: 401,
        error: "site_mismatch",
      });
    });

    it("refuses a grant whose parent editor row has been revoked", async () => {
      const grant = makeGrant();
      mockCreateServiceRoleClient.mockReturnValue(
        stubServiceClient(
          grantRow(grant, {
            site_editors: {
              id: EDITOR_ID,
              site_id: SITE_ID,
              email: "bob@corp.example",
              permissions: ["edit"],
              revoked_at: new Date().toISOString(),
            },
          }),
        ),
      );

      const result = await validateEditorAccess({
        siteId: SITE_ID,
        token: { kind: "device-grant", token: grant },
        deviceContext: deviceAt(MINTING_ORIGIN),
      });

      expect(result).toMatchObject({
        valid: false,
        status: 401,
        error: "editor_revoked",
      });
    });

    it("accepts a grant presented from the origin that minted it, graded by the parent row", async () => {
      const grant = makeGrant();
      mockCreateServiceRoleClient.mockReturnValue(
        stubServiceClient(grantRow(grant)),
      );

      const result = await validateEditorAccess({
        siteId: SITE_ID,
        token: { kind: "device-grant", token: grant },
        deviceContext: deviceAt(MINTING_ORIGIN),
      });

      expect(result.valid).toBe(true);
      expect(result.access).toMatchObject({
        kind: "device-grant",
        siteId: SITE_ID,
        email: "bob@corp.example",
        // Widened by normalizePermissions, the single widening rule, from the
        // parent site_editors row — not from anything inside the token.
        permissions: ["view", "edit"],
        verified: true,
        // The edit is not attributable to any staging invite.
        stagingAccessId: null,
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
