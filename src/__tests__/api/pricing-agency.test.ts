const mockGetPlanCatalogue = jest.fn();
const mockGetFoundingAgencyAvailability = jest.fn();
const mockRetrievePrice = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: { prices: { retrieve: mockRetrievePrice } },
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: mockGetPlanCatalogue,
  resolveOneTimePriceId: jest.fn(async () => "price_one_time"),
  resolveStripePriceId: jest.fn(async () => "price_subscription"),
  isPaidPlanId: (value: unknown) =>
    value === "starter" || value === "pro" || value === "agency",
}));

jest.mock("@/lib/billing/founding-agency", () => ({
  getFoundingAgencyAvailability: mockGetFoundingAgencyAvailability,
}));

const limits = {
  websites: 10,
  collaborators: -1,
  aiFeatures: true,
  translations: -1,
  abTesting: true,
  monthlyCredits: 1000,
};

const catalogue = {
  subscriptions: [
    {
      id: "agency",
      name: "Agency",
      description: "For client work",
      price: 49,
      yearlyPrice: 40.83,
      yearlyTotal: 490,
      features: ["10 client websites"],
      limits,
      additionalSitePrice: 4,
      sortOrder: 30,
    },
  ],
  oneTimeProducts: [
    {
      id: "lifetime_agency",
      name: "Founding Agency (lifetime)",
      description: "Permanent Agency access",
      price: 299,
      features: ["Everything in Agency"],
      grantsPlanId: "agency",
      sortOrder: 35,
    },
  ],
  creditPack: {
    creditsPerPack: 1000,
    maxPacksPerPurchase: 100,
    pricePerPack: 10,
  },
};

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockGetPlanCatalogue.mockResolvedValue(catalogue);
  mockGetFoundingAgencyAvailability.mockResolvedValue({
    remaining: 17,
    limit: 50,
    soldOut: false,
  });
  mockRetrievePrice.mockRejectedValue(new Error("Use catalogue amounts"));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/pricing Agency payload", () => {
  it("returns exact annual pricing and the cached aggregate availability", async () => {
    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET(new Request("http://localhost/api/pricing"));
    const body = await response.json();

    expect(body.plans).toEqual([
      expect.objectContaining({
        id: "agency",
        monthlyPrice: 49,
        yearlyPrice: 40.83,
        yearlyTotal: 490,
      }),
    ]);
    expect(body.foundingAgencyAvailability).toEqual({
      remaining: 17,
      limit: 50,
      soldOut: false,
    });
    expect(Object.keys(body.foundingAgencyAvailability).sort()).toEqual([
      "limit",
      "remaining",
      "soldOut",
    ]);
  });

  it("keeps catalogue pricing available without inventing founding spots", async () => {
    mockGetFoundingAgencyAvailability.mockRejectedValue(
      new Error("aggregate unavailable"),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/pricing/route");
    const response = await GET(new Request("http://localhost/api/pricing"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plans[0].id).toBe("agency");
    expect(body.foundingAgencyAvailability).toBeNull();
  });

  it("drops expired cached availability when a later catalogue refresh fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/pricing/route");
    const request = new Request("http://localhost/api/pricing");

    const first = await (await GET(request)).json();
    expect(first.foundingAgencyAvailability.remaining).toBe(17);

    const afterCacheTtl = Date.now() + 5 * 60 * 1000 + 1;
    jest.spyOn(Date, "now").mockReturnValue(afterCacheTtl);
    mockGetPlanCatalogue.mockRejectedValue(new Error("catalogue unavailable"));

    const stale = await (await GET(request)).json();

    expect(stale.plans[0].id).toBe("agency");
    expect(stale.foundingAgencyAvailability).toBeNull();
  });
});
