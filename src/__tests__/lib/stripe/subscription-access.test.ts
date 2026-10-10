const mockGetEffectivePlan = jest.fn();

jest.mock("@/lib/billing/entitlements", () => ({
  getEffectivePlan: (...args: unknown[]) => mockGetEffectivePlan(...args),
}));

import { checkFeatureAccess } from "@/lib/stripe/subscription";

describe("checkFeatureAccess", () => {
  it("treats -1 collaborators as unlimited access", async () => {
    mockGetEffectivePlan.mockResolvedValue({
      kind: "plan",
      source: "subscription",
      plan: {
        limits: {
          websites: 10,
          collaborators: -1,
          aiFeatures: true,
          translations: -1,
          abTesting: true,
          monthlyCredits: 1000,
        },
      },
    });

    await expect(
      checkFeatureAccess("user-agency", "collaborators"),
    ).resolves.toBe(true);
  });
});
