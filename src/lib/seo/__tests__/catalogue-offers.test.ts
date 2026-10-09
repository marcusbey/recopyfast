/**
 * s88 — the JSON-LD offers are the plans the homepage sells, at the catalogue's
 * price.
 *
 * The rule is `/api/pricing`'s (route.ts:199-206): every active subscription
 * plan except `free`, and Agency only while its checkout switch is on. Prices
 * are `plans.price_monthly` (Non-negotiable 7: the database catalogue is the
 * source of truth; no fallback price). Every Stripe price is created in USD
 * (scripts/sync-stripe-catalogue.mjs).
 */

jest.mock("@/lib/stripe/plans", () => ({
  getPlanCatalogue: jest.fn(),
  isAgencyCheckoutEnabled: jest.fn(),
}));

import { getPlanCatalogue, isAgencyCheckoutEnabled } from "@/lib/stripe/plans";
import { loadCatalogueOffers } from "../catalogue-offers";

const mockedCatalogue = jest.mocked(getPlanCatalogue);
const mockedAgencySwitch = jest.mocked(isAgencyCheckoutEnabled);

function plan(id: string, name: string, price: number) {
  return { id, name, price, yearlyPrice: price, features: [], limits: {} };
}

const CATALOGUE = {
  subscriptions: [
    plan("free", "Free", 0),
    plan("starter", "Starter", 9),
    plan("pro", "Pro", 19),
    plan("agency", "Agency", 49),
  ],
  oneTimeProducts: [
    { id: "lifetime_agency", name: "Founding Agency", price: 499 },
    { id: "credits", name: "AI credits", price: 5 },
  ],
  creditPack: { creditsPerPack: 100 },
};

const SITE = "https://recopyfa.st";

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  mockedCatalogue.mockResolvedValue(CATALOGUE as never);
  mockedAgencySwitch.mockReturnValue(true);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("loadCatalogueOffers", () => {
  it("offers every sellable subscription plan at its catalogue price, in USD", async () => {
    expect(await loadCatalogueOffers(SITE)).toEqual([
      { name: "Starter", price: 9, currency: "USD", url: `${SITE}/#pricing` },
      { name: "Pro", price: 19, currency: "USD", url: `${SITE}/#pricing` },
      { name: "Agency", price: 49, currency: "USD", url: `${SITE}/#pricing` },
    ]);
  });

  it("does not sell the free plan nor any one-time product", async () => {
    const names = (await loadCatalogueOffers(SITE)).map((offer) => offer.name);

    expect(names).not.toContain("Free");
    expect(names).not.toContain("Founding Agency");
    expect(names).not.toContain("AI credits");
  });

  it("does not offer Agency while its checkout is switched off", async () => {
    mockedAgencySwitch.mockReturnValue(false);

    const names = (await loadCatalogueOffers(SITE)).map((offer) => offer.name);

    expect(names).toEqual(["Starter", "Pro"]);
  });

  it("offers nothing, and logs, when the catalogue cannot be read", async () => {
    mockedCatalogue.mockRejectedValue(new Error("fetch failed"));

    expect(await loadCatalogueOffers(SITE)).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });
});
