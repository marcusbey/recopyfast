/**
 * GET /api/billing/entitlement
 *
 * The dashboard shell asks this on every page to decide what to draw. It
 * exists because the nav previously read `user.user_metadata.plan` — a key
 * nothing ever wrote, so every account including a paying subscriber fell back
 * to "free" and had its Pro links disabled.
 *
 * It is presentation only. Nothing here authorises anything, and these tests
 * pin the shape the client depends on rather than any access decision.
 */

const mockSupabase = {
  auth: { getUser: jest.fn() },
};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => Promise.resolve(mockSupabase)),
}));

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: jest.fn(),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  readTrialGrant: jest.fn(),
}));

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(),
}));

import { GET } from "@/app/api/billing/entitlement/route";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { readTrialGrant } from "@/lib/billing/effective-plan";
import { getUserSubscription } from "@/lib/stripe/subscription";
import type { Entitlement } from "@/lib/billing/effective-plan";
import type { Subscription } from "@/types/billing";

const mockGetEffectivePlan = getEffectivePlan as jest.MockedFunction<
  typeof getEffectivePlan
>;
const mockReadTrialGrant = readTrialGrant as jest.MockedFunction<
  typeof readTrialGrant
>;

const signedIn = () =>
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });

describe("GET /api/billing/entitlement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an anonymous caller", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockGetEffectivePlan).not.toHaveBeenCalled();
  });

  it("reports the plan a subscriber is on", async () => {
    signedIn();
    mockGetEffectivePlan.mockResolvedValue({
      kind: "plan",
      planId: "pro",
      plan: { name: "Pro" },
    } as unknown as Entitlement);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "plan",
      planId: "pro",
      planName: "Pro",
    });
  });

  it("reports a credit holder as entitled by credits, not by a plan", async () => {
    signedIn();
    mockGetEffectivePlan.mockResolvedValue({
      kind: "credits",
      planId: null,
      plan: null,
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      kind: "credits",
      planId: null,
      planName: null,
    });
  });

  it("reports an unentitled account as holding nothing", async () => {
    signedIn();
    mockGetEffectivePlan.mockResolvedValue({
      kind: "none",
      planId: null,
      plan: null,
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      kind: "none",
      planId: null,
      planName: null,
    });
  });

  it("refuses to label a plan id it does not recognise", async () => {
    // The catalogue and the PaidPlanId union having drifted is a bug worth
    // shouting about, and the honest answer is "no plan we can render" rather
    // than casting an unknown id into the union and mislabelling the sidebar.
    signedIn();
    mockGetEffectivePlan.mockResolvedValue({
      kind: "plan",
      planId: "enterprise",
      plan: { name: "Enterprise" },
    } as unknown as Entitlement);

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      kind: "plan",
      planId: null,
      planName: "Enterprise",
    });
    expect(console.error).toHaveBeenCalled();
  });

  /**
   * The trial countdown the dashboard badge draws.
   *
   * Presentation only, like everything else on this route: a countdown is not
   * an authorisation decision, and the gates never read it. It rides here
   * rather than on a new route because the shell already asks this question on
   * every page.
   */
  describe("trial countdown", () => {
    const PRO_PLAN = {
      kind: "plan",
      planId: "pro",
      plan: { name: "Pro" },
    } as unknown as Entitlement;

    const IN_NINE_DAYS = new Date(
      Date.now() + 8.4 * 24 * 60 * 60 * 1000,
    ).toISOString();

    it("reports the days left on a running trial", async () => {
      signedIn();
      mockGetEffectivePlan.mockResolvedValue(PRO_PLAN);
      mockReadTrialGrant.mockResolvedValue({
        grantedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        expiresAt: IN_NINE_DAYS,
        isActive: true,
      });
      (getUserSubscription as jest.Mock).mockResolvedValue(null);

      const body = await (await GET()).json();

      // Rounded up: eight-and-a-bit days remaining is "9 days left", which is
      // what a customer counting down would say.
      expect(body.trial).toEqual({ daysRemaining: 9, endsAt: IN_NINE_DAYS });
    });

    it("says nothing about a trial for an account that has none", async () => {
      signedIn();
      mockGetEffectivePlan.mockResolvedValue(PRO_PLAN);
      mockReadTrialGrant.mockResolvedValue(null);

      const body = await (await GET()).json();

      expect(body.trial).toBeUndefined();
    });

    it("says nothing about a trial that has already ended", async () => {
      signedIn();
      mockGetEffectivePlan.mockResolvedValue(PRO_PLAN);
      mockReadTrialGrant.mockResolvedValue({
        grantedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        expiresAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        isActive: false,
      });

      const body = await (await GET()).json();

      expect(body.trial).toBeUndefined();
    });

    it("stops counting down once the customer is being billed", async () => {
      // Conversion is reflected by the countdown disappearing. The trial grant
      // is left to lapse on its own clock — nothing revokes it — so without
      // this check a paying customer would keep being told their trial is
      // running out.
      signedIn();
      mockGetEffectivePlan.mockResolvedValue(PRO_PLAN);
      mockReadTrialGrant.mockResolvedValue({
        grantedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        expiresAt: IN_NINE_DAYS,
        isActive: true,
      });
      (getUserSubscription as jest.Mock).mockResolvedValue({
        id: "sub_1",
      } as unknown as Subscription);

      const body = await (await GET()).json();

      expect(body.trial).toBeUndefined();
    });

    it("does not look for a trial for an account with no plan at all", async () => {
      // An active trial always resolves to `kind: "plan"`, so anything else
      // cannot be trialling and must not cost an extra query on every page.
      signedIn();
      mockGetEffectivePlan.mockResolvedValue({
        kind: "none",
        planId: null,
        plan: null,
      });

      await GET();

      expect(mockReadTrialGrant).not.toHaveBeenCalled();
    });
  });

  it("answers 500 rather than a misleading entitlement when the read fails", async () => {
    signedIn();
    mockGetEffectivePlan.mockRejectedValue(new Error("supabase down"));

    const response = await GET();

    expect(response.status).toBe(500);
    // Not a 200 with kind:"none" — that would render a paywall to a paying
    // customer on a transient database error.
    await expect(response.json()).resolves.toEqual({ error: "server_error" });
  });
});
