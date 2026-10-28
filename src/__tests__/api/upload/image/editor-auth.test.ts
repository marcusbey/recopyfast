/**
 * M5 — uploads use the real editor credential validator.
 *
 * The route-level unit suite proves ordering and refusal side effects. This
 * suite keeps `validateEditorTokenFromRequest` real so a public site bearer,
 * stale/revoked grant, unverified staging link, or view-only editor cannot be
 * accidentally accepted by an optimistic route mock.
 */
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import { POST } from "@/app/api/upload/image/route";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "@/lib/auth/editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { normalizeImage } from "@/lib/images/process";
import { uploadSiteAsset } from "@/lib/storage/upload";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.10"),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  checkOwnerCanEdit: jest.fn(async () => ({ ok: true, ownerId: "owner-1" })),
  ownerCanEditRefusal: jest.fn(),
}));
jest.mock("@/lib/images/sniff", () => ({
  sniffImageFormat: jest.fn(() => ({ format: "png", extension: "png" })),
  isRasterFormat: jest.fn(() => true),
}));
jest.mock("@/lib/images/process", () => ({
  normalizeImage: jest.fn(async () => ({
    ok: true,
    value: {
      data: Buffer.from("normalized"),
      contentType: "image/png",
      width: 10,
      height: 8,
    },
  })),
}));
jest.mock("@/lib/storage/upload", () => ({
  uploadSiteAsset: jest.fn(async () => ({
    ok: true,
    value: { url: "https://assets.example/image.png", key: "image.png" },
  })),
}));

const SITE_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const OTHER_SITE_ID = "0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d";
const ORIGIN = "https://customer.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";
const GRANT_ID = "grant-row-1";
const EDITOR_ID = "editor-1";
const EDIT_TOKEN = "edit-session-token";
const STAGING_TOKEN = "staging-token";

interface Op {
  table: string;
  kind: "select" | "update";
  filters: Array<["eq" | "gte", string, unknown]>;
}

function makeClient(rows: Partial<Record<string, unknown>>) {
  function from(table: string) {
    const op: Op = { table, kind: "select", filters: [] };
    const resolve = () => {
      const source = rows[table];
      const candidates = Array.isArray(source) ? source : [source];
      const data = candidates.find((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return false;
        return op.filters.every(([operator, column, expected]) => {
          const actual = (candidate as Record<string, unknown>)[column];
          if (operator === "eq") return actual === expected;
          return (
            typeof actual === "string" &&
            typeof expected === "string" &&
            actual >= expected
          );
        });
      });
      return Promise.resolve({ data: data ?? null, error: null });
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: () => {
        op.kind = "update";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push(["eq", column, value]);
        return builder;
      },
      gte: (column: string, value: unknown) => {
        op.filters.push(["gte", column, value]);
        return builder;
      },
      single: resolve,
      maybeSingle: resolve,
      then: (
        ok: (value: unknown) => unknown,
        fail?: (error: unknown) => unknown,
      ) => resolve().then(ok, fail),
    };
    return builder;
  }
  return { from } as unknown as ReturnType<typeof createServiceRoleClient>;
}

function grant(overrides: Record<string, unknown> = {}) {
  return encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
    g: GRANT_ID,
    s: SITE_ID,
    o: hashOrigin(ORIGIN),
    x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    n: "nonce",
    ...overrides,
  });
}

function grantRow(token: string, overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    site_editor_id: EDITOR_ID,
    grant_hash: hashOpaqueSecret(token),
    user_agent_hash: hashUserAgent(USER_AGENT),
    origin_hash: hashOrigin(ORIGIN),
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    revoked_reason: null,
    site_editors: {
      id: EDITOR_ID,
      site_id: SITE_ID,
      email: "editor@example.com",
      permissions: ["edit"],
      revoked_at: null,
    },
    ...overrides,
  };
}

function form(tokens: { editToken?: string; stagingToken?: string } = {}) {
  const file = new Blob(["png-bytes"], { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => Buffer.from("png-bytes").buffer,
  });
  const values = new Map<string, Blob | string>([
    ["siteId", SITE_ID],
    ["file", file],
  ]);
  if (tokens.editToken) values.set("editToken", tokens.editToken);
  if (tokens.stagingToken) values.set("stagingToken", tokens.stagingToken);
  return { get: (name: string) => values.get(name) ?? null } as FormData;
}

function upload(options: {
  headers?: Record<string, string>;
  tokens?: { editToken?: string; stagingToken?: string };
  siteId?: string;
}) {
  const body = form(options.tokens);
  if (options.siteId) {
    const originalGet = body.get.bind(body);
    body.get = ((name: string) =>
      name === "siteId"
        ? options.siteId!
        : originalGet(name)) as FormData["get"];
  }
  const request = new NextRequest("https://www.recopyfa.st/api/upload/image", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "User-Agent": USER_AGENT,
      ...options.headers,
    },
  });
  Object.defineProperty(request, "formData", { value: async () => body });
  return POST(request);
}

function stagingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "staging-1",
    site_id: SITE_ID,
    token: STAGING_TOKEN,
    access_type: "invite",
    email: "editor@example.com",
    email_verified: true,
    permissions: ["edit"],
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    is_active: true,
    verified_user_agent_hash: hashUserAgent(USER_AGENT),
    verified_at: new Date().toISOString(),
    ...overrides,
  };
}

const mockService = jest.mocked(createServiceRoleClient);
const mockNormalize = jest.mocked(normalizeImage);
const mockUpload = jest.mocked(uploadSiteAsset);
const mockOwnerGate = jest.mocked(checkOwnerCanEdit);

describe("POST /api/upload/image — real editor credentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["no credential", {}],
    [
      "public site bearer",
      { headers: { Authorization: "Bearer public-site-token" } },
    ],
  ])("refuses %s before processing or storage", async (_label, options) => {
    mockService.mockReturnValue(makeClient({}));

    const response = await upload(options);

    expect(response.status).toBe(401);
    expect(mockOwnerGate).not.toHaveBeenCalled();
    expect(mockNormalize).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong-site", () => grant({ s: OTHER_SITE_ID }), {}],
    ["expired", () => grant({ x: Math.floor((Date.now() - 1000) / 1000) }), {}],
    [
      "revoked",
      () => grant(),
      { revoked_at: new Date().toISOString(), revoked_reason: "manual" },
    ],
    [
      "view-only",
      () => grant(),
      {
        site_editors: {
          id: EDITOR_ID,
          site_id: SITE_ID,
          email: "editor@example.com",
          permissions: ["view"],
          revoked_at: null,
        },
      },
    ],
  ])(
    "refuses a %s device grant before processing",
    async (_label, tokenFactory, rowOverrides) => {
      const token = tokenFactory();
      mockService.mockReturnValue(
        makeClient({ editor_device_grants: grantRow(token, rowOverrides) }),
      );

      const response = await upload({
        headers: { "X-RCF-Editor-Grant": token },
      });

      expect([401, 403]).toContain(response.status);
      expect(mockOwnerGate).not.toHaveBeenCalled();
      expect(mockNormalize).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    },
  );

  it("refuses an unverified staging device before processing", async () => {
    mockService.mockReturnValue(
      makeClient({
        staging_access: stagingRow({ email_verified: false }),
        site_editors: null,
      }),
    );

    const response = await upload({ tokens: { stagingToken: STAGING_TOKEN } });

    expect(response.status).toBe(401);
    expect(mockOwnerGate).not.toHaveBeenCalled();
    expect(mockNormalize).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads with a verified device grant", async () => {
    const token = grant();
    mockService.mockReturnValue(
      makeClient({ editor_device_grants: grantRow(token) }),
    );

    const response = await upload({ headers: { "X-RCF-Editor-Grant": token } });

    expect(response.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: SITE_ID }),
    );
  });

  it("uploads with an edit session whose holder still has edit access", async () => {
    mockService.mockReturnValue(
      makeClient({
        edit_sessions: {
          id: "session-1",
          site_id: SITE_ID,
          token: EDIT_TOKEN,
          is_active: true,
          user_id: "collaborator-1",
          permissions: ["edit"],
          created_at: new Date(Date.now() - 60 * 1000).toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        site_permissions: {
          site_id: SITE_ID,
          user_id: "collaborator-1",
          permission: "edit",
        },
      }),
    );

    const response = await upload({ tokens: { editToken: EDIT_TOKEN } });

    expect(response.status).toBe(200);
    expect(mockUpload).toHaveBeenCalled();
  });

  it("refuses an edit session bound to another site", async () => {
    mockService.mockReturnValue(
      makeClient({
        edit_sessions: {
          id: "session-1",
          site_id: OTHER_SITE_ID,
          token: EDIT_TOKEN,
          is_active: true,
          user_id: "collaborator-1",
          permissions: ["edit"],
          created_at: new Date(Date.now() - 60 * 1000).toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        site_permissions: {
          site_id: SITE_ID,
          user_id: "collaborator-1",
          permission: "edit",
        },
      }),
    );

    const response = await upload({ tokens: { editToken: EDIT_TOKEN } });

    expect(response.status).toBe(401);
    expect(mockOwnerGate).not.toHaveBeenCalled();
    expect(mockNormalize).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads with a verified staging token", async () => {
    mockService.mockReturnValue(
      makeClient({ staging_access: stagingRow(), site_editors: null }),
    );

    const response = await upload({ tokens: { stagingToken: STAGING_TOKEN } });

    expect(response.status).toBe(200);
    expect(mockUpload).toHaveBeenCalled();
  });
});
