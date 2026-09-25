jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: jest.fn(),
  isAgencyCheckoutEnabled: jest.fn(),
}));

jest.mock("@/lib/billing/founding-agency", () => ({
  getFoundingAgencyAvailability: jest.fn(),
}));

import { getFoundingAgencyAvailability } from "@/lib/billing/founding-agency";
import type { OneTimeProduct, SubscriptionPlan } from "@/lib/stripe/plan-types";
import { getPlanCatalogue, isAgencyCheckoutEnabled } from "@/lib/stripe/plans";
import { loadComparisonPricing } from "../comparison-pricing";

const mockGetPlanCatalogue = jest.mocked(getPlanCatalogue);
const mockGetFoundingAgencyAvailability = jest.mocked(
  getFoundingAgencyAvailability,
);
const mockIsAgencyCheckoutEnabled = jest.mocked(isAgencyCheckoutEnabled);

const agency = {
  id: "agency",
  name: "Agency",
  description: "For client work",
  price: 73,
  yearlyPrice: 61,
  yearlyTotal: 732,
  features: [],
  limits: {
    websites: 14,
    collaborators: -1,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 1000,
  },
  additionalSitePrice: 4,
  sortOrder: 30,
} satisfies SubscriptionPlan;

const founding = {
  id: "lifetime_agency",
  name: "Founding Agency",
  description: "Permanent Agency access",
  price: 411,
  features: [],
  grantsPlanId: "agency",
  sortOrder: 40,
} satisfies OneTimeProduct;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockIsAgencyCheckoutEnabled.mockReturnValue(true);
  mockGetPlanCatalogue.mockResolvedValue({
    subscriptions: [agency],
    oneTimeProducts: [founding],
    creditPack: {
      creditsPerPack: 1000,
      maxPacksPerPurchase: 100,
      pricePerPack: 10,
    },
  });
  mockGetFoundingAgencyAvailability.mockResolvedValue({
    remaining: 9,
    limit: 50,
    soldOut: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("comparison pricing", () => {
  it("reads changed Agency and founding values from the live catalogue", async () => {
    await expect(loadComparisonPricing()).resolves.toEqual({
      status: "available",
      agency: { monthlyPrice: 73, websites: 14 },
      founding: {
        price: 411,
        availability: { remaining: 9, limit: 50, soldOut: false },
      },
    });
  });

  it("does not read or advertise the catalogue when Agency checkout is disabled", async () => {
    mockIsAgencyCheckoutEnabled.mockReturnValue(false);

    await expect(loadComparisonPricing()).resolves.toEqual({
      status: "disabled",
    });
    expect(mockGetPlanCatalogue).not.toHaveBeenCalled();
    expect(mockGetFoundingAgencyAvailability).not.toHaveBeenCalled();
  });

  it("keeps live Agency pricing but marks founding availability unknown when its read fails", async () => {
    mockGetFoundingAgencyAvailability.mockRejectedValue(
      new Error("aggregate unavailable"),
    );

    await expect(loadComparisonPricing()).resolves.toEqual({
      status: "available",
      agency: { monthlyPrice: 73, websites: 14 },
      founding: { price: 411, availability: null },
    });
  });

  it("fails without inventing prices when the catalogue or Agency row is unavailable", async () => {
    mockGetPlanCatalogue.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(loadComparisonPricing()).resolves.toEqual({
      status: "unavailable",
    });

    mockGetPlanCatalogue.mockResolvedValueOnce({
      subscriptions: [],
      oneTimeProducts: [],
      creditPack: {
        creditsPerPack: 1000,
        maxPacksPerPurchase: 100,
        pricePerPack: 10,
      },
    });
    await expect(loadComparisonPricing()).resolves.toEqual({
      status: "unavailable",
    });
  });
});
