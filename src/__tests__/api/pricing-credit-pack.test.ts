const mockGetPlanCatalogue = jest.fn();
const mockGetFoundingAgencyAvailability = jest.fn();
const mockRetrievePrice = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: { prices: { retrieve: mockRetrievePrice } },
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: mockGetPlanCatalogue,
  resolveOneTimePriceId: jest.fn(async (id: string) => `price_${id}`),
  resolveStripePriceId: jest.fn(async () => "price_subscription"),
  isAgencyCheckoutEnabled: () => true,
  isPaidPlanId: (value: unknown) =>
    value === "starter" || value === "pro" || value === "agency",
}));

jest.mock("@/lib/billing/founding-agency", () => ({
  getFoundingAgencyAvailability: mockGetFoundingAgencyAvailability,
}));

/**
 * s47b — the landing's founding-offer fine print names the credit pack
 * ("1,000 credits for $19") from this payload, never from a literal. The pack
 * size lives in the catalogue's `creditPack`, so the route carries it on the
 * `credits` product, and only there.
 */

// A module, not a script: pricing-agency.test.ts declares the same mock names.
export {};

function catalogueWithPack(creditsPerPack: number) {
  return {
    subscriptions: [],
    oneTimeProducts: [
      {
        id: "credits",
        name: "Credits",
        description: "AI credits",
        price: 10,
        features: [],
        grantsPlanId: null,
        sortOrder: 40,
      },
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
      creditsPerPack,
      maxPacksPerPurchase: 100,
      pricePerPack: 10,
    },
  };
}

type ProductPayload = { id: string; price: number; creditsPerPack?: number };

async function readProducts(): Promise<ProductPayload[]> {
  const { GET } = await import("@/app/api/pricing/route");
  const body = await (
    await GET(new Request("http://localhost/api/pricing"))
  ).json();
  return body.oneTimeProducts;
}

function product(products: ProductPayload[], id: string): ProductPayload {
  const found = products.find((entry) => entry.id === id);
  expect(found).toBeDefined();
  return found as ProductPayload;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
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

describe("GET /api/pricing credit pack", () => {
  it("carries the pack size on the credits product, and only there", async () => {
    mockGetPlanCatalogue.mockResolvedValue(catalogueWithPack(1000));

    const products = await readProducts();

    expect(product(products, "credits").creditsPerPack).toBe(1000);
    expect(product(products, "lifetime_agency")).not.toHaveProperty(
      "creditsPerPack",
    );
  });

  it("prices the pack at the Stripe amount when Stripe answers", async () => {
    mockGetPlanCatalogue.mockResolvedValue(catalogueWithPack(500));
    mockRetrievePrice.mockImplementation(async (priceId: string) =>
      priceId === "price_credits"
        ? { unit_amount: 1900 }
        : Promise.reject(new Error("Use catalogue amounts")),
    );

    const credits = product(await readProducts(), "credits");

    expect(credits.price).toBe(19);
    expect(credits.creditsPerPack).toBe(500);
  });
});
