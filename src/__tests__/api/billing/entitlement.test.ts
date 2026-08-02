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

import { GET } from "@/app/api/billing/entitlement/route";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import type { Entitlement } from "@/lib/billing/effective-plan";

const mockGetEffectivePlan = getEffectivePlan as jest.MockedFunction<
  typeof getEffectivePlan
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
