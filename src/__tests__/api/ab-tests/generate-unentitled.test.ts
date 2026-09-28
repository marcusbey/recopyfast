/**
 * POST /api/ab-tests/generate: the SITE OWNER's plan decides, and the owner
 * pays (s56, ADR 042).
 *
 * The route used to read `plan.limits.abTesting` off whatever
 * `getEffectivePlan` returned, which for an unpaid account was the free row.
 * That worked only because the row happened to have `ab_testing: false`.
 *
 * s56 then keyed it to the owner, in the `ai/suggest` shape (ADR 035/040).
 * Before, the capability check, the credit check and the charge all read the
 * CALLER: a collaborator with a plan could generate on a lapsed owner's site,
 * and a collaborator without one was refused on a paying owner's site —
 * `hasEnoughCredits` even read through the cookie client, where RLS hides the
 * owner's wallet. Now the owner-plan gate runs first, the capability is read
 * from the owner's entitlement, and the owner is charged before the model is
 * called, with a refund on every failure after it.
 *
 * Only the entitlement and owner reads are stubbed, never the gate itself —
 * mocking the gate is how a fail-open ships green (owner-plan-gate.test.ts).
 */

const OWNER = "owner-1";
const COLLABORATOR = "collaborator-1";
const SITE = "site-1";
const RECEIPT = { usageId: "usage-ab-1", userId: OWNER, credits: 3 };

const getUser = jest.fn();
const single = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser },
    from: jest.fn(() => {
      const chain: Record<string, unknown> = { single };
      for (const method of ["select", "eq"]) {
        chain[method] = jest.fn(() => chain);
      }
      return chain;
    }),
  })),
}));

/** What the service client's `ab_tests` / `ab_test_variants` writes answer. */
const serviceResult: Record<string, { data: unknown; error: unknown }> = {};
const serviceWrites: Array<{ table: string; op: string }> = [];

const mockServiceClient = {
  from: jest.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ["insert", "delete"]) {
      chain[op] = jest.fn(() => {
        serviceWrites.push({ table, op });
        return chain;
      });
    }
    for (const method of ["select", "eq"]) {
      chain[method] = jest.fn(() => chain);
    }
    const settled = () => serviceResult[table] ?? { data: null, error: null };
    chain.single = jest.fn(() => Promise.resolve(settled()));
    chain.then = (
      ok: (value: unknown) => unknown,
      err?: (reason: unknown) => unknown,
    ) => Promise.resolve(settled()).then(ok, err);
    return chain;
  }),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockServiceClient),
}));

jest.mock("@/lib/ai/openai-service", () => ({
  aiService: { generateABVariants: jest.fn() },
}));

jest.mock("@/lib/credits/system", () => ({
  CREDIT_COSTS: { AB_TEST_GENERATION: 3 },
  consumeCredits: jest.fn(),
  refundCharge: jest.fn(),
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
  enforceRateLimit: jest.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/ab-tests/generate/route";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import { resolveSiteOwnerId } from "@/lib/feature-gating/permissions";
import { consumeCredits, refundCharge } from "@/lib/credits/system";
import { aiService } from "@/lib/ai/openai-service";
import { enforceRateLimit } from "@/lib/api/rate-limit";

const asMock = (fn: unknown) => fn as jest.Mock;

const planWithAbTesting = (abTesting: boolean) => ({
  kind: "plan",
  planId: abTesting ? "pro" : "starter",
  plan: { limits: { abTesting } },
});
const NONE = { kind: "none", planId: null, plan: null };
const CREDITS = { kind: "credits", planId: null, plan: null };

function generateRequest(): NextRequest {
  return new NextRequest("https://app.test/api/ab-tests/generate", {
    method: "POST",
    body: JSON.stringify({
      site_id: SITE,
      element_id: "hero-h1",
      original_text: "Ship faster",
    }),
  });
}

/** The owner's entitlement decides; anyone else's must never be read. */
function entitlements(owner: unknown, others: unknown = NONE) {
  asMock(resolveEntitlement).mockImplementation(async (_client, userId) =>
    userId === OWNER ? owner : others,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const table of Object.keys(serviceResult)) delete serviceResult[table];
  serviceWrites.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: OWNER } } });
  single.mockResolvedValue({ data: { permission: "admin" }, error: null });
  asMock(enforceRateLimit).mockResolvedValue(null);
  asMock(resolveSiteOwnerId).mockResolvedValue(OWNER);
  entitlements(planWithAbTesting(true));
  asMock(consumeCredits).mockResolvedValue({
    success: true,
    remainingCredits: 97,
    charge: RECEIPT,
  });
  asMock(refundCharge).mockResolvedValue({ success: true, refunded: 3 });
  asMock(aiService.generateABVariants).mockResolvedValue({
    success: true,
    data: [{ name: "Urgency", content: "Ship today", rationale: "Urgency" }],
  });
  serviceResult.ab_tests = { data: { id: "test-1" }, error: null };
  serviceResult.ab_test_variants = { data: [], error: null };
});

describe("A/B test generation is keyed to the site owner", () => {
  it("refuses a lapsed owner's site with 402 plan_ended before charging, calling the model or writing", async () => {
    entitlements(NONE, planWithAbTesting(true));

    const response = await POST(generateRequest());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.reason).toBe("plan_ended");
    expect(consumeCredits).not.toHaveBeenCalled();
    expect(aiService.generateABVariants).not.toHaveBeenCalled();
    expect(serviceWrites).toEqual([]);
  });

  it("refuses a credits-only owner's site the same way: credits buy no plan capability", async () => {
    entitlements(CREDITS);

    const response = await POST(generateRequest());

    expect(response.status).toBe(402);
    expect((await response.json()).reason).toBe("plan_ended");
    expect(consumeCredits).not.toHaveBeenCalled();
    expect(aiService.generateABVariants).not.toHaveBeenCalled();
  });

  it("lets a collaborator with no plan and no credits generate on a paying owner's site, charging the owner", async () => {
    getUser.mockResolvedValue({ data: { user: { id: COLLABORATOR } } });
    single.mockResolvedValue({ data: { permission: "edit" }, error: null });
    entitlements(planWithAbTesting(true), NONE);

    const response = await POST(generateRequest());

    expect(response.status).toBe(200);
    expect(resolveEntitlement).not.toHaveBeenCalledWith(
      expect.anything(),
      COLLABORATOR,
    );
    expect(consumeCredits).toHaveBeenCalledWith(
      OWNER,
      3,
      "ab_test_generation",
      expect.anything(),
      mockServiceClient,
    );
  });

  it("charges before the model is called", async () => {
    await POST(generateRequest());

    const charged = asMock(consumeCredits).mock.invocationCallOrder[0];
    const modelled = asMock(aiService.generateABVariants).mock
      .invocationCallOrder[0];
    expect(charged).toBeLessThan(modelled);
  });

  it("still refuses an owner whose plan does not include A/B testing, before any charge", async () => {
    entitlements(planWithAbTesting(false));

    const response = await POST(generateRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("A/B testing requires a Pro plan");
    expect(consumeCredits).not.toHaveBeenCalled();
    expect(aiService.generateABVariants).not.toHaveBeenCalled();
  });

  it("refunds the charge when the model fails", async () => {
    asMock(aiService.generateABVariants).mockResolvedValue({
      success: false,
      error: "provider down",
    });

    const response = await POST(generateRequest());

    expect(response.status).toBe(500);
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(refundCharge).toHaveBeenCalledWith(RECEIPT);
    expect(serviceWrites).toEqual([]);
  });

  it("refunds the charge when the test insert fails", async () => {
    serviceResult.ab_tests = { data: null, error: { message: "boom" } };

    const response = await POST(generateRequest());

    expect(response.status).toBe(500);
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(refundCharge).toHaveBeenCalledWith(RECEIPT);
  });

  it("refunds the charge and removes the test when the variant insert fails", async () => {
    serviceResult.ab_test_variants = { data: null, error: { message: "boom" } };

    const response = await POST(generateRequest());

    expect(response.status).toBe(500);
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(refundCharge).toHaveBeenCalledWith(RECEIPT);
    expect(serviceWrites).toContainEqual({ table: "ab_tests", op: "delete" });
  });
});
