/**
 * s51 — a grant obtained through `POST /api/editor/handoff/redeem` still cannot
 * write to a lapsed owner's site.
 *
 * Redemption itself is deliberately NOT gated on the owner's plan (ADR 041).
 * Its 60-second code is only checked inside `redeemHandoff`, which also
 * consumes the code and mints the grant in one call, and the only check in
 * front of it is a forgeable Origin header — so a plan gate there would answer
 * "plan ended" to anyone holding a public site id: an oracle on a customer's
 * billing. What makes that safe is what this suite proves end to end:
 *
 *   - a code can only be minted by `handoff/create`, which IS gated and
 *     authenticated (its own suite pins the refusal);
 *   - whatever grant redemption mints, every write it could make is gated, so
 *     on a lapsed owner's site the first save is refused with the plan-ended
 *     402 — and the same grant saves again once the owner picks a plan.
 *
 * Everything on the path is real: the redeem route and `redeemHandoff`, the
 * grant minting and sealing, the staging save route, the device-grant
 * validation, `checkOwnerCanEdit`. Stubbed: the database (a small stateful
 * in-memory one), the limiter, and the owner's entitlement.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import { hashOpaqueSecret } from "@/lib/auth/editor-crypto";

type Row = Record<string, unknown>;

// RFC 4122 v4, as gen_random_uuid() issues: since s77 (s69 R1) the staging
// content route refuses an id `requireUuid` rejects before any work.
const SITE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OWNER_ID = "owner-1";
const EDITOR_ID = "site-editor-1";
const ORIGIN = "https://helloworld.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";
const HANDOFF_CODE = "handoff-code-from-the-hub";

/** Table name → rows. Joins are attached on read, as PostgREST embeds them. */
const mockTables: Record<string, Row[]> = {};
const mockRpcCalls: string[] = [];

function mockEmbed(table: string, row: Row): Row {
  if (table === "editor_device_grants" || table === "editor_handoffs") {
    const editor = (mockTables.site_editors ?? []).find(
      (candidate) => candidate.id === row.site_editor_id,
    );
    return { ...row, site_editors: editor ?? null };
  }
  return row;
}

function mockServiceClient() {
  let nextId = 1;

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mutation: { kind: "insert" | "update"; payload: Row } | null = null;
    let inserted: Row | null = null;

    const matching = () =>
      (mockTables[table] ?? []).filter((row) =>
        filters.every((filter) => filter(row)),
      );

    const run = (): Row[] => {
      if (mutation?.kind === "insert") {
        if (!inserted) {
          inserted = { id: `row-${nextId++}`, ...mutation.payload };
          mockTables[table] = [...(mockTables[table] ?? []), inserted];
        }
        return [inserted];
      }
      const rows = matching();
      if (mutation?.kind === "update") {
        const changes = mutation.payload;
        mockTables[table] = (mockTables[table] ?? []).map((row) =>
          rows.includes(row) ? { ...row, ...changes } : row,
        );
        const ids = new Set(rows.map((row) => row.id));
        return (mockTables[table] ?? []).filter((row) => ids.has(row.id));
      }
      return rows.map((row) => mockEmbed(table, row));
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (payload: Row) => {
        mutation = { kind: "insert", payload };
        return builder;
      },
      update: (payload: Row) => {
        mutation = { kind: "update", payload };
        return builder;
      },
      delete: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(onOk, onErr),
    };
    return builder;
  }

  async function rpc(name: string) {
    mockRpcCalls.push(name);
    return {
      data: [{ updated_at: "2026-09-28T12:00:00.000Z" }],
      error: null,
    };
  }

  return { from, rpc };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceClient()),
}));
// No dashboard session: the editor holds nothing but the redeemed grant.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    }),
  ),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  ...jest.requireActual("@/lib/api/rate-limit"),
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/feature-gating/permissions", () => ({
  ...jest.requireActual("@/lib/feature-gating/permissions"),
  resolveSiteOwnerId: jest.fn(() => Promise.resolve("owner-1")),
}));
jest.mock("@/lib/billing/effective-plan", () => ({
  ...jest.requireActual("@/lib/billing/effective-plan"),
  resolveEntitlement: jest.fn(),
}));

import { POST as REDEEM } from "@/app/api/editor/handoff/redeem/route";
import { PUT as SAVE } from "@/app/api/staging/content/[siteId]/route";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import type { Entitlement } from "@/lib/billing/effective-plan";
import { PLAN_ENDED_MESSAGE } from "@/lib/billing/owner-can-edit";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";

const mockResolveEntitlement = resolveEntitlement as jest.MockedFunction<
  typeof resolveEntitlement
>;

const LAPSED: Entitlement = { kind: "none", planId: null, plan: null };
const ON_PLAN: Entitlement = {
  kind: "plan",
  planId: "pro",
  plan: { id: "pro", name: "Pro" } as SubscriptionPlan,
};

const browserHeaders = {
  "Content-Type": "application/json",
  Origin: ORIGIN,
  "User-Agent": USER_AGENT,
};

function redeem(): Promise<Response> {
  return REDEEM(
    new NextRequest("https://www.recopyfa.st/api/editor/handoff/redeem", {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ code: HANDOFF_CODE, siteId: SITE_ID }),
    }),
  ) as unknown as Promise<Response>;
}

function saveWith(grant: string): Promise<Response> {
  return SAVE(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      headers: { ...browserHeaders, "X-RCF-Editor-Grant": grant },
      body: JSON.stringify({ elementId: "headline", content: "New copy" }),
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as unknown as Promise<Response>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockRpcCalls.length = 0;
  mockTables.sites = [{ id: SITE_ID, domain: "helloworld.example" }];
  mockTables.site_editors = [
    {
      id: EDITOR_ID,
      site_id: SITE_ID,
      email: "bob@corp.example",
      permissions: ["view", "edit", "publish"],
      revoked_at: null,
    },
  ];
  // What the gated `handoff/create` left behind for this editor.
  mockTables.editor_handoffs = [
    {
      id: "handoff-1",
      code_hash: hashOpaqueSecret(HANDOFF_CODE),
      remember_device: false,
      expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
      consumed_at: null,
      site_editor_id: EDITOR_ID,
    },
  ];
  mockTables.editor_device_grants = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("s51 — a grant redeemed for a lapsed owner's site", () => {
  it("is refused with the plan-ended 402 on its first staging save, and saves once the owner picks a plan", async () => {
    mockResolveEntitlement.mockResolvedValue(LAPSED);

    // Redemption is not gated: it answers as it always has.
    const redeemed = await redeem();
    expect(redeemed.status).toBe(200);
    const { grant } = (await redeemed.json()) as { grant: string };
    expect(grant).toMatch(/^rcfg1\./);
    expect(mockTables.editor_device_grants).toHaveLength(1);

    const refused = await saveWith(grant);
    expect(refused.status).toBe(402);
    await expect(refused.json()).resolves.toMatchObject({
      error: PLAN_ENDED_MESSAGE,
      reason: "plan_ended",
    });
    expect(mockRpcCalls).not.toContain("save_staging_content_atomic");
    // Keyed by the owner, and nothing revoked on the way.
    expect(mockResolveEntitlement).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
    );
    expect(mockTables.editor_device_grants[0].revoked_at ?? null).toBeNull();

    // The owner pays; the very same grant writes.
    mockResolveEntitlement.mockResolvedValue(ON_PLAN);
    const saved = await saveWith(grant);
    expect(saved.status).toBe(200);
    expect(mockRpcCalls).toContain("save_staging_content_atomic");
  });

  it("reads no plan while redeeming, so the answer is the same for a lapsed or paying owner", async () => {
    mockResolveEntitlement.mockResolvedValue(LAPSED);
    const lapsed = await redeem();
    const lapsedBody = await lapsed.json();

    // A second code for the same editor, owner now on a plan.
    mockTables.editor_handoffs = [
      { ...mockTables.editor_handoffs[0], consumed_at: null },
    ];
    mockResolveEntitlement.mockResolvedValue(ON_PLAN);
    const paying = await redeem();
    const payingBody = await paying.json();

    expect(lapsed.status).toBe(paying.status);
    expect(Object.keys(lapsedBody).sort()).toEqual(
      Object.keys(payingBody).sort(),
    );
    expect(mockResolveEntitlement).not.toHaveBeenCalled();
  });
});
