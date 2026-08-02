/**
 * POST /api/ab-tests/generate refuses an account with no plan.
 *
 * The route used to read `plan.limits.abTesting` off whatever
 * `getEffectivePlan` returned, which for an unpaid account was the free row.
 * That worked only because the row happened to have `ab_testing: false`.
 */

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

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/ai/openai-service", () => ({
  aiService: { generateABVariants: jest.fn() },
}));

jest.mock("@/lib/credits/system", () => ({
  CREDIT_COSTS: { AB_TEST_GENERATION: 3 },
  hasEnoughCredits: jest.fn(),
  consumeCredits: jest.fn(),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/ab-tests/generate/route";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { hasEnoughCredits } from "@/lib/credits/system";
import { aiService } from "@/lib/ai/openai-service";

const asMock = (fn: unknown) => fn as jest.Mock;

function generateRequest(): NextRequest {
  return new NextRequest("https://app.test/api/ab-tests/generate", {
    method: "POST",
    body: JSON.stringify({
      site_id: "site-1",
      element_id: "hero-h1",
      original_text: "Ship faster",
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  single.mockResolvedValue({ data: { permission: "admin" }, error: null });
});

describe("A/B test generation without a plan", () => {
  it("refuses with 403 before spending credits or calling the model", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });

    const response = await POST(generateRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("no active plan");
    expect(body.upgrade_required).toBe(true);
    expect(hasEnoughCredits).not.toHaveBeenCalled();
    expect(aiService.generateABVariants).not.toHaveBeenCalled();
  });

  it("refuses a credit holder, since A/B testing is a plan capability", async () => {
    // Credits pay for metered usage of capabilities a plan grants. A/B testing
    // is one of those capabilities, not a meter, so a wallet does not buy it
    // even though generating a test also costs credits.
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "credits",
      planId: null,
      plan: null,
    });

    const response = await POST(generateRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("requires a plan");
    expect(hasEnoughCredits).not.toHaveBeenCalled();
    expect(aiService.generateABVariants).not.toHaveBeenCalled();
  });

  it("still refuses a plan that does not include A/B testing", async () => {
    asMock(getEffectivePlan).mockResolvedValue({
      kind: "plan",
      planId: "starter",
      plan: { limits: { abTesting: false } },
    });

    const response = await POST(generateRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("Pro plan");
  });
});
