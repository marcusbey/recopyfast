/**
 * @jest-environment node
 */

/**
 * s51 — every content write needs the SITE OWNER's plan; no public read does.
 *
 * Before s51 nothing on the write side read a plan. A lapsed trial, a
 * credits-only account, or an owner whose subscription had ended kept saving
 * and publishing live, and so did every editor and API key they had issued.
 * This table is the story's proof, route by route, through the REAL handlers
 * and the REAL `checkOwnerCanEdit`. Mocking the gate itself is how a fail-open
 * ships green, so the entitlement is mocked where it is computed
 * (`resolveEntitlement`, `resolveSiteOwnerId`) and nowhere above it.
 *
 * Stubbed, and only these:
 *   - the entitlement and owner reads, to put the owner on a plan or not;
 *   - the rate limiter, which admits every request;
 *   - authentication and authorization, each granting admin on SITE (or, for
 *     the no-oracle rows, refusing);
 *   - a recording Supabase fake behind all three client factories, so a
 *     refusal is asserted on what was NOT written, not only on its status;
 *   - the model, so a refusal is asserted on what was NOT spent.
 */

import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const SITE = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const STYLE = "44444444-4444-4444-8444-444444444444";
const AB_TEST = "66666666-6666-4666-8666-666666666666";
const SITE_API_KEY = "site-api-key-secret";
const SITE_DOMAIN = "customer.example";
const ORIGIN = `https://${SITE_DOMAIN}`;
const SIGNED_IN_USER = { id: OWNER, email: "owner@customer.example" };
/** A manager on the site with an account — and a plan — of their own. */
const COLLABORATOR = "55555555-5555-4555-8555-555555555555";

type Mutation = {
  client: string;
  table: string;
  op: "insert" | "update" | "upsert" | "delete" | "rpc";
};

type Row = Record<string, unknown>;

/**
 * The recording fake's state. `rows` answers list reads (sliced by `.range()`
 * so the paged readers terminate), `row` answers `.single()`/`.maybeSingle()`,
 * `rpcData` answers `.rpc()`. Every insert/update/upsert/delete/rpc is recorded.
 */
const mockDb: {
  user: typeof SIGNED_IN_USER | null;
  rows: Record<string, Row[]>;
  row: Record<string, Row | null>;
  rpcData: Record<string, unknown>;
  mutations: Mutation[];
} = { user: null, rows: {}, row: {}, rpcData: {}, mutations: [] };

function mockMakeClient(client: string) {
  const settle = <T>(value: T) => ({
    then: (ok: (v: T) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(ok, err),
  });

  const builder = (table: string) => {
    let range: [number, number] | null = null;
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "gt",
      "gte",
      "lt",
      "lte",
      "or",
      "not",
      "match",
      "filter",
      "order",
      "limit",
      "returns",
    ]) {
      chain[method] = () => chain;
    }
    chain.range = (from: number, to: number) => {
      range = [from, to];
      return chain;
    };
    for (const op of ["insert", "update", "upsert", "delete"] as const) {
      chain[op] = () => {
        mockDb.mutations.push({ client, table, op });
        return chain;
      };
    }
    const one = () =>
      Promise.resolve({
        data:
          table in mockDb.row
            ? mockDb.row[table]
            : (mockDb.rows[table]?.[0] ?? null),
        error: null,
      });
    chain.single = one;
    chain.maybeSingle = one;
    chain.then = (
      ok: (v: unknown) => unknown,
      err?: (e: unknown) => unknown,
    ) => {
      const all = mockDb.rows[table] ?? [];
      const data = range ? all.slice(range[0], range[1] + 1) : all;
      return Promise.resolve({ data, error: null, count: all.length }).then(
        ok,
        err,
      );
    };
    return chain;
  };

  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: mockDb.user }, error: null }),
    },
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      mockDb.mutations.push({ client, table: name, op: "rpc" });
      return settle({ data: mockDb.rpcData[name] ?? [], error: null });
    },
  };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockMakeClient("service")),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockMakeClient("cookie"))),
}));
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => mockMakeClient("ssr")),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  ...jest.requireActual("@/lib/billing/effective-plan"),
  resolveEntitlement: jest.fn(),
}));
jest.mock("@/lib/feature-gating/permissions", () => ({
  ...jest.requireActual("@/lib/feature-gating/permissions"),
  resolveSiteOwnerId: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  ...jest.requireActual("@/lib/api/rate-limit"),
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/auth/editor-access", () => ({
  ...jest.requireActual("@/lib/auth/editor-access"),
  authorizeFirstPartyEditorAccess: jest.fn(),
  validateEditorTokenFromRequest: jest.fn(),
}));
jest.mock("@/lib/api/rate-limiter", () => ({
  ...jest.requireActual("@/lib/api/rate-limiter"),
  validateAPIKey: jest.fn(),
}));

import { resolveEntitlement } from "@/lib/billing/effective-plan";
import type { Entitlement } from "@/lib/billing/effective-plan";
import { resolveSiteOwnerId } from "@/lib/feature-gating/permissions";
import {
  authorizeFirstPartyEditorAccess,
  validateEditorTokenFromRequest,
  type EditorAccess,
} from "@/lib/auth/editor-access";
import { validateAPIKey } from "@/lib/api/rate-limiter";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { aiService } from "@/lib/ai/openai-service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { PLAN_ENDED_MESSAGE } from "@/lib/billing/owner-can-edit";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

import * as stagingContent from "@/app/api/staging/content/[siteId]/route";
import * as stagingPublish from "@/app/api/staging/publish/route";
import * as historyVersion from "@/app/api/edit-board/history/[versionId]/route";
import * as stylesApply from "@/app/api/edit-board/styles/apply/route";
import * as bulkImport from "@/app/api/bulk/import/route";
import * as bulkUpdate from "@/app/api/bulk/update/route";
import * as bulkExport from "@/app/api/bulk/export/route";
import * as v1Content from "@/app/api/v1/content/route";
import * as aiTranslate from "@/app/api/ai/translate/route";
import * as aiSuggest from "@/app/api/ai/suggest/route";
import * as publicContent from "@/app/api/content/[siteId]/route";
import * as abTests from "@/app/api/ab-tests/route";
import * as abTestsGenerate from "@/app/api/ab-tests/generate/route";

const mockResolveEntitlement = resolveEntitlement as jest.MockedFunction<
  typeof resolveEntitlement
>;
const mockResolveSiteOwnerId = resolveSiteOwnerId as jest.MockedFunction<
  typeof resolveSiteOwnerId
>;
const mockFirstParty = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;
const mockEditorToken = validateEditorTokenFromRequest as jest.MockedFunction<
  typeof validateEditorTokenFromRequest
>;
const mockValidateAPIKey = validateAPIKey as jest.MockedFunction<
  typeof validateAPIKey
>;

const PRO: SubscriptionPlan = {
  id: "pro",
  name: "Pro",
  description: "",
  price: 19,
  yearlyPrice: 190,
  features: [],
  limits: {
    websites: 5,
    collaborators: 5,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 500,
  },
  additionalSitePrice: 5,
  sortOrder: 1,
};
const ON_PLAN: Entitlement = { kind: "plan", planId: "pro", plan: PRO };
const CREDITS_ONLY: Entitlement = { kind: "credits", planId: null, plan: null };
const LAPSED: Entitlement = { kind: "none", planId: null, plan: null };

const ALL_PERMISSIONS: EditorAccess["permissions"] = [
  "view",
  "edit",
  "publish",
  "admin",
];

const OWNER_SESSION_ACCESS: EditorAccess = {
  kind: "edit-session",
  siteId: SITE,
  token: "",
  permissions: ALL_PERMISSIONS,
  email: SIGNED_IN_USER.email,
  userId: OWNER,
  verified: true,
};

/** An invited editor on a device grant: no account, no plan of their own. */
const DEVICE_GRANT_ACCESS: EditorAccess = {
  kind: "device-grant",
  siteId: SITE,
  token: "device-grant-token",
  permissions: ALL_PERMISSIONS,
  email: "editor@agency.example",
  userId: null,
  verified: true,
};

const API_KEY = {
  id: "key-1",
  site_id: SITE,
  permissions: { content_read: true, content_write: true },
  rate_limit_per_minute: null,
};

type Call = () => Promise<Response>;

const url = (path: string) => `https://www.recopyfa.st${path}`;

function json(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "User-Agent": "jest",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const siteParams = { params: Promise.resolve({ siteId: SITE }) };
const versionParams = { params: Promise.resolve({ versionId: VERSION }) };
const bearer = { Authorization: "Bearer staging-token" };
const apiKeyHeader = { "X-API-Key": "rcf_live_key" };

/**
 * Every handler that writes content (or spends AI on it), with the caller the
 * handler actually authenticates. `ok` is the status a paying owner gets.
 * `serviceOnly` marks a route whose every write must go through the service
 * client: since s56 (ADR 042) no web principal holds DML on the A/B tables.
 */
const WRITE_ROUTES: Array<{
  name: string;
  ok: number;
  call: Call;
  serviceOnly?: boolean;
}> = [
  {
    name: "staging PUT",
    ok: 200,
    call: () =>
      stagingContent.PUT(
        json("PUT", `/api/staging/content/${SITE}`, {
          elementId: "hero",
          content: "New copy",
        }),
        siteParams,
      ),
  },
  {
    name: "publish POST",
    ok: 200,
    call: () =>
      stagingPublish.POST(
        json("POST", "/api/staging/publish", { siteId: SITE }),
      ),
  },
  {
    name: "version restore POST",
    ok: 200,
    call: () =>
      historyVersion.POST(
        json("POST", `/api/edit-board/history/${VERSION}`, {}, bearer),
        versionParams,
      ),
  },
  {
    name: "styles/apply POST",
    ok: 200,
    call: () =>
      stylesApply.POST(
        json(
          "POST",
          "/api/edit-board/styles/apply",
          { siteId: SITE, styleId: STYLE },
          bearer,
        ),
      ),
  },
  {
    name: "bulk import POST",
    ok: 200,
    call: () =>
      bulkImport.POST(
        json("POST", "/api/bulk/import", {
          site_id: SITE,
          format: "json",
          data: [
            { element_id: "hero", selector: "#hero", current_content: "Hi" },
          ],
          options: { overwrite_existing: true },
        }),
      ),
  },
  {
    name: "bulk update POST",
    ok: 200,
    call: () =>
      bulkUpdate.POST(
        json("POST", "/api/bulk/update", {
          site_id: SITE,
          operations: [{ element_id: "hero", operation: "set", value: "Hi" }],
        }),
      ),
  },
  {
    name: "v1 content POST",
    ok: 200,
    call: () =>
      v1Content.POST(
        json(
          "POST",
          "/api/v1/content",
          { site_id: SITE, element_id: "hero", content: "Hi" },
          apiKeyHeader,
        ),
      ),
  },
  {
    name: "v1 content PUT",
    ok: 200,
    call: () =>
      v1Content.PUT(
        json(
          "PUT",
          "/api/v1/content",
          { site_id: SITE, element_id: "hero", content: "Hi" },
          apiKeyHeader,
        ),
      ),
  },
  {
    name: "ai/translate POST",
    ok: 200,
    call: () =>
      aiTranslate.POST(
        json("POST", "/api/ai/translate", {
          siteId: SITE,
          fromLanguage: "en",
          toLanguage: "fr",
          elements: [{ id: "hero", text: "Hello" }],
        }),
      ),
  },
  {
    name: "ai/suggest POST",
    ok: 200,
    call: () =>
      aiSuggest.POST(
        json("POST", "/api/ai/suggest", {
          siteId: SITE,
          text: "Hello",
          context: "hero",
        }),
      ),
  },
  {
    name: "ab-tests POST",
    ok: 200,
    serviceOnly: true,
    call: () =>
      abTests.POST(
        json("POST", "/api/ab-tests", {
          site_id: SITE,
          name: "Hero test",
          success_metric: "conversion_rate",
          variants: [
            {
              content_element_id: "ce-1",
              variant_name: "control",
              content: "Hello",
              traffic_percentage: 50,
            },
            {
              content_element_id: "ce-1",
              variant_name: "bolder",
              content: "Hello!",
              traffic_percentage: 50,
            },
          ],
        }),
      ),
  },
  {
    name: "ab-tests PUT",
    ok: 200,
    serviceOnly: true,
    call: () =>
      abTests.PUT(
        json("PUT", "/api/ab-tests", { test_id: AB_TEST, status: "active" }),
      ),
  },
  {
    name: "ab-tests/generate POST",
    ok: 200,
    serviceOnly: true,
    call: () =>
      abTestsGenerate.POST(
        json("POST", "/api/ab-tests/generate", {
          site_id: SITE,
          element_id: "hero",
          original_text: "Hello",
        }),
      ),
  },
];

/** Public delivery and every read the editor makes. None may read a plan. */
const READ_ROUTES: Array<{ name: string; call: Call }> = [
  {
    name: "content GET",
    call: () =>
      publicContent.GET(
        json("GET", `/api/content/${SITE}`, undefined, {
          Authorization: `Bearer ${buildSiteToken(SITE, SITE_API_KEY)}`,
        }),
        siteParams,
      ),
  },
  {
    name: "discovery POST",
    call: () =>
      publicContent.POST(
        json(
          "POST",
          `/api/content/${SITE}`,
          { hero: { content: "Hello", selector: "#hero" } },
          { Authorization: `Bearer ${buildSiteToken(SITE, SITE_API_KEY)}` },
        ),
        siteParams,
      ),
  },
  {
    name: "v1 content GET",
    call: () =>
      v1Content.GET(json("GET", "/api/v1/content", undefined, apiKeyHeader)),
  },
  {
    name: "bulk export POST",
    call: () =>
      bulkExport.POST(
        json("POST", "/api/bulk/export", { site_id: SITE, format: "json" }),
      ),
  },
  {
    name: "bulk export GET",
    call: () => bulkExport.GET(json("GET", `/api/bulk/export?siteId=${SITE}`)),
  },
  {
    name: "staging content GET",
    call: () =>
      stagingContent.GET(
        json("GET", `/api/staging/content/${SITE}`),
        siteParams,
      ),
  },
  {
    name: "publish preview GET",
    call: () =>
      stagingPublish.GET(json("GET", `/api/staging/publish?siteId=${SITE}`)),
  },
  {
    name: "history GET",
    call: () =>
      historyVersion.GET(
        json("GET", `/api/edit-board/history/${VERSION}`, undefined, bearer),
        versionParams,
      ),
  },
];

/** Tables a lapse must never touch: nothing is revoked, nothing reissued. */
const CREDENTIAL_TABLES = [
  "editor_device_grants",
  "edit_sessions",
  "site_editors",
  "api_keys",
  "staging_access",
];

function seedDatabase() {
  mockDb.user = SIGNED_IN_USER;
  mockDb.mutations = [];
  mockDb.row = {
    sites: { id: SITE, domain: SITE_DOMAIN, api_key: SITE_API_KEY },
    site_permissions: {
      id: "perm-1",
      permission: "admin",
      user_id: OWNER,
    },
    content_versions: { id: VERSION, site_id: SITE, version_number: 1 },
    // The A/B test PUT reads back its own site before the gate (s56).
    ab_tests: { id: AB_TEST, site_id: SITE },
    copy_styles: { id: STYLE, name: "Bold", prompt: "Make it bold" },
    billing_subscriptions: null,
  };
  mockDb.rows = {
    content_elements: [
      {
        id: "ce-1",
        site_id: SITE,
        element_id: "hero",
        selector: "#hero",
        staging_content: "Draft",
        published_content: "Hello",
        original_content: "Hello",
        current_content: "Hello",
        language: "en",
        variant: "default",
        page_path: null,
        metadata: {},
      },
    ],
    bulk_operations: [],
  };
  mockDb.rpcData = {
    spend_credits: [{ outcome: "charged", usage_id: "usage-1", remaining: 99 }],
    save_staging_content_atomic: [{ updated_at: "2026-09-28T00:00:00Z" }],
  };
}

function grantEveryCredential() {
  mockFirstParty.mockResolvedValue(OWNER_SESSION_ACCESS);
  mockEditorToken.mockResolvedValue({
    valid: true,
    access: DEVICE_GRANT_ACCESS,
  });
  jest.spyOn(StagingAccessManager, "validateStagingAccess").mockResolvedValue({
    valid: true,
    verified: true,
    permissions: ["view", "edit", "publish", "admin"],
    email: "editor@agency.example",
    expiresAt: null,
  } as unknown as Awaited<
    ReturnType<typeof StagingAccessManager.validateStagingAccess>
  >);
  mockValidateAPIKey.mockResolvedValue({ valid: true, apiKey: API_KEY });
}

function refuseEveryCredential() {
  mockDb.user = null;
  mockFirstParty.mockResolvedValue(null);
  mockEditorToken.mockResolvedValue({
    valid: false,
    error: "Missing editor token",
    status: 401,
  });
  jest.spyOn(StagingAccessManager, "validateStagingAccess").mockResolvedValue({
    valid: false,
    verified: false,
    permissions: [],
    email: null,
    expiresAt: null,
    error: "Invalid staging token",
  } as unknown as Awaited<
    ReturnType<typeof StagingAccessManager.validateStagingAccess>
  >);
  mockValidateAPIKey.mockResolvedValue({
    valid: false,
    error: "Invalid API key",
  });
}

let suggestSpy: jest.SpyInstance;
let translateSpy: jest.SpyInstance;
let generateSpy: jest.SpyInstance;
let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-test-owner-plan-gate";
});

beforeEach(() => {
  jest.clearAllMocks();
  seedDatabase();
  grantEveryCredential();
  mockResolveSiteOwnerId.mockResolvedValue(OWNER);
  mockResolveEntitlement.mockResolvedValue(ON_PLAN);
  suggestSpy = jest
    .spyOn(aiService, "generateContentSuggestion")
    .mockResolvedValue({ success: true, data: ["Bolder"], tokensUsed: 3 });
  translateSpy = jest.spyOn(aiService, "batchTranslate").mockResolvedValue({
    success: true,
    data: [{ id: "hero", originalText: "Hello", translatedText: "Bonjour" }],
    tokensUsed: 3,
  } as unknown as Awaited<ReturnType<typeof aiService.batchTranslate>>);
  generateSpy = jest.spyOn(aiService, "generateABVariants").mockResolvedValue({
    success: true,
    data: [{ name: "Bolder", content: "Hello!", rationale: "Emphasis" }],
    tokensUsed: 3,
  } as unknown as Awaited<ReturnType<typeof aiService.generateABVariants>>);
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Spies only: the module factories above must keep their implementations.
  for (const spy of [
    suggestSpy,
    translateSpy,
    generateSpy,
    consoleError,
    consoleWarn,
  ]) {
    spy.mockRestore();
  }
});

const aiSpend = () =>
  suggestSpy.mock.calls.length +
  translateSpy.mock.calls.length +
  generateSpy.mock.calls.length;

describe.each(WRITE_ROUTES)("$name", ({ name, ok, call, serviceOnly }) => {
  it(`refuses ${name} for a lapsed owner with 402 plan_ended and writes nothing`, async () => {
    mockResolveEntitlement.mockResolvedValue(LAPSED);

    const response = await call();

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toMatchObject({
      reason: "plan_ended",
      upgradeRequired: true,
      error: PLAN_ENDED_MESSAGE,
      message: PLAN_ENDED_MESSAGE,
    });
    expect(mockDb.mutations).toEqual([]);
    expect(aiSpend()).toBe(0);
    // Keyed by the site's owner, whoever is calling.
    expect(mockResolveEntitlement).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
    );
  });

  it(`refuses ${name} for a credits-only owner`, async () => {
    mockResolveEntitlement.mockResolvedValue(CREDITS_ONLY);

    const response = await call();

    expect(response.status).toBe(402);
    expect((await response.json()).reason).toBe("plan_ended");
    expect(mockDb.mutations).toEqual([]);
    expect(aiSpend()).toBe(0);
  });

  it(`lets ${name} through for an owner on a plan`, async () => {
    const response = await call();

    expect(response.status).toBe(ok);
    expect(mockDb.mutations.length).toBeGreaterThan(0);
    if (serviceOnly) {
      expect(
        mockDb.mutations.filter((mutation) => mutation.client !== "service"),
      ).toEqual([]);
    }
  });

  it(`answers an uncredentialed caller of ${name} with its own refusal, never plan_ended`, async () => {
    refuseEveryCredential();
    mockResolveEntitlement.mockResolvedValue(LAPSED);

    const response = await call();

    expect([400, 401, 403, 404]).toContain(response.status);
    expect(JSON.stringify(await response.json())).not.toContain(
      PLAN_ENDED_MESSAGE,
    );
    expect(mockResolveSiteOwnerId).not.toHaveBeenCalled();
    expect(mockResolveEntitlement).not.toHaveBeenCalled();
    expect(mockDb.mutations).toEqual([]);
  });
});

/**
 * Every caller above is the owner, so a gate keyed on the CALLER would pass
 * them all. Here the caller is a collaborator whose own plan disagrees with
 * the owner's, on every credential path a route accepts (cookie session,
 * first-party access, editor token), and only the owner's plan may decide.
 */
describe.each(WRITE_ROUTES)(
  "$name, called by a collaborator",
  ({ name, call }) => {
    function callAsCollaborator(owner: Entitlement, collaborator: Entitlement) {
      mockDb.user = { id: COLLABORATOR, email: "manager@client.example" };
      mockFirstParty.mockResolvedValue({
        ...OWNER_SESSION_ACCESS,
        userId: COLLABORATOR,
        email: "manager@client.example",
      });
      mockEditorToken.mockResolvedValue({
        valid: true,
        access: { ...DEVICE_GRANT_ACCESS, userId: COLLABORATOR },
      });
      mockResolveEntitlement.mockImplementation(async (_client, userId) =>
        userId === OWNER ? owner : collaborator,
      );
      return call();
    }

    it(`keys ${name} on the owner: a paying collaborator on a lapsed owner's site is refused`, async () => {
      const response = await callAsCollaborator(LAPSED, ON_PLAN);

      expect(response.status).toBe(402);
      expect((await response.json()).reason).toBe("plan_ended");
      expect(mockDb.mutations).toEqual([]);
      expect(aiSpend()).toBe(0);
    });

    it(`keys ${name} on the owner: a planless collaborator on a paying owner's site is not refused as plan_ended`, async () => {
      const response = await callAsCollaborator(ON_PLAN, LAPSED);

      expect(response.status).not.toBe(402);
      expect(JSON.stringify(await response.json())).not.toContain(
        PLAN_ENDED_MESSAGE,
      );
    });
  },
);

describe.each(READ_ROUTES)("$name", ({ name, call }) => {
  it(`serves ${name} for a lapsed owner without reading any entitlement`, async () => {
    mockResolveEntitlement.mockResolvedValue(LAPSED);

    const response = await call();

    expect(response.status).toBe(200);
    expect(mockResolveEntitlement).not.toHaveBeenCalled();
    expect(mockResolveSiteOwnerId).not.toHaveBeenCalled();
  });
});

describe("a lapse revokes nothing, and a plan restores access", () => {
  const credentialWrites = () =>
    mockDb.mutations.filter((m) => CREDENTIAL_TABLES.includes(m.table));

  it("an editor of a lapsed owner writes again with the same grant once the owner picks a plan", async () => {
    // Through the device-grant path, not the owner's session.
    mockFirstParty.mockResolvedValue(null);
    const save = () =>
      stagingContent.PUT(
        json(
          "PUT",
          `/api/staging/content/${SITE}`,
          { elementId: "hero", content: "New copy" },
          { "X-RCF-Editor-Grant": "device-grant-token" },
        ),
        siteParams,
      );

    mockResolveEntitlement.mockResolvedValue(LAPSED);
    const refused = await save();
    expect(refused.status).toBe(402);

    mockResolveEntitlement.mockResolvedValue(ON_PLAN);
    const accepted = await save();
    expect(accepted.status).toBe(200);

    expect(mockEditorToken).toHaveBeenCalledTimes(2);
    expect(credentialWrites()).toEqual([]);
  });

  it("an API key of a lapsed owner writes again once the owner picks a plan", async () => {
    const write = () =>
      v1Content.POST(
        json(
          "POST",
          "/api/v1/content",
          { site_id: SITE, element_id: "hero", content: "Hi" },
          apiKeyHeader,
        ),
      );

    mockResolveEntitlement.mockResolvedValue(LAPSED);
    expect((await write()).status).toBe(402);

    mockResolveEntitlement.mockResolvedValue(ON_PLAN);
    expect((await write()).status).toBe(200);

    expect(mockValidateAPIKey).toHaveBeenCalledTimes(2);
    expect(credentialWrites()).toEqual([]);
  });

  it("the WebSocket service has no content write path", () => {
    // It broadcasts what a gated PUT already saved; it never writes one. The
    // widget emits only after a successful save, so a refused save never
    // reaches a broadcast (s51 research, "Left ungated deliberately").
    const source = readFileSync(
      join(process.cwd(), "server", "index.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\.from\(\s*["'`]content_elements["'`]\s*\)/);
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.upsert\(/);
  });
});
