/**
 * Plan catalogue loader.
 *
 * Prices, limits and feature lists live in the `plans` table, so these tests
 * cover the two things that can now go wrong: the loader mis-reading a row, and
 * the seed drifting from what the product actually sells.
 */

const selectMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            returns: selectMock,
          })),
        })),
      })),
    })),
  })),
}));

import {
  clearPlanCatalogueCache,
  getCreditPackConfig,
  getOneTimeProduct,
  getPaidPlan,
  getPlanCatalogue,
  getPlanCyclePrice,
  getPlanDisplayPrice,
  getPlanForSubscriber,
  isPaidPlanId,
  PAID_PLAN_IDS,
  resolveOneTimePriceId,
  resolveStripePriceId,
  findSubscriptionPlan,
  sellablePlans,
} from "@/lib/stripe/plans";

interface SeedRowOverrides {
  [key: string]: unknown;
}

/**
 * NUMERIC columns are deliberately strings here: that is what PostgREST sends,
 * and treating them as numbers is exactly the bug the loader has to prevent.
 */
function planRow(overrides: SeedRowOverrides = {}) {
  return {
    id: "pro",
    kind: "subscription",
    name: "Pro",
    description: "Up to 5 websites",
    price_monthly: "19.00",
    price_yearly_monthly_equivalent: "15.77",
    stripe_price_id_test: null,
    stripe_price_id_live: null,
    stripe_yearly_price_id_test: null,
    stripe_yearly_price_id_live: null,
    limits: {
      websites: 5,
      collaborators: 5,
      ai_features: true,
      translations: -1,
      ab_testing: true,
      monthly_credits: 500,
    },
    features: ["Up to 5 websites"],
    additional_site_price: "5.00",
    grants_plan_id: null,
    is_active: true,
    sort_order: 20,
    ...overrides,
  };
}

const FREE_ROW = planRow({
  id: "free",
  name: "Free",
  description: "No active subscription",
  price_monthly: "0.00",
  price_yearly_monthly_equivalent: "0.00",
  limits: {
    websites: 0,
    collaborators: 0,
    ai_features: false,
    translations: 0,
    ab_testing: false,
    monthly_credits: 0,
  },
  features: [],
  additional_site_price: null,
  sort_order: 0,
});

const STARTER_ROW = planRow({
  id: "starter",
  name: "Starter",
  description: "1 website",
  price_monthly: "9.00",
  price_yearly_monthly_equivalent: "7.47",
  limits: {
    websites: 1,
    collaborators: 0,
    ai_features: false,
    translations: 0,
    ab_testing: false,
    monthly_credits: 0,
  },
  features: ["1 website"],
  additional_site_price: null,
  sort_order: 10,
});

const CREDITS_ROW = planRow({
  id: "credits",
  kind: "one_time",
  name: "Credits",
  description: "1,000 AI credits",
  price_monthly: "19.00",
  price_yearly_monthly_equivalent: null,
  limits: { credits_per_pack: 1000, max_packs_per_purchase: 100 },
  features: ["1,000 AI credits"],
  additional_site_price: null,
  sort_order: 30,
});

const LIFETIME_ROW = planRow({
  id: "lifetime_pro",
  kind: "one_time",
  name: "Lifetime Pro",
  description: "Pay once",
  price_monthly: "199.00",
  price_yearly_monthly_equivalent: null,
  limits: {},
  features: ["Everything in Pro"],
  additional_site_price: null,
  grants_plan_id: "pro",
  sort_order: 40,
});

const FULL_SEED = [FREE_ROW, STARTER_ROW, planRow(), CREDITS_ROW, LIFETIME_ROW];

function respondWith(rows: unknown[]) {
  selectMock.mockResolvedValue({ data: rows, error: null });
}

describe("plan catalogue loader", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearPlanCatalogueCache();
    selectMock.mockReset();
    respondWith(FULL_SEED);
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_monthly";
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = "price_pro_yearly";
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter_monthly";
    process.env.STRIPE_STARTER_YEARLY_PRICE_ID = "price_starter_yearly";
    process.env.STRIPE_TICKETS_PRICE_ID = "price_credits";
    process.env.STRIPE_LIFETIME_PRICE_ID = "price_lifetime";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("row parsing", () => {
    it("parses NUMERIC columns arriving as strings into numbers", async () => {
      const plan = await getPaidPlan("pro");

      expect(plan.price).toBe(19);
      expect(plan.yearlyPrice).toBe(15.77);
      expect(plan.additionalSitePrice).toBe(5);
    });

    it("maps snake_case limit keys onto the camelCase gate contract", async () => {
      const plan = await getPaidPlan("pro");

      expect(plan.limits).toEqual({
        websites: 5,
        collaborators: 5,
        aiFeatures: true,
        translations: -1,
        abTesting: true,
        monthlyCredits: 500,
      });
    });

    it("leaves additionalSitePrice null when the plan sells no extra sites", async () => {
      const plan = await getPaidPlan("starter");

      expect(plan.additionalSitePrice).toBeNull();
    });

    it("splits subscriptions from one-time products by kind", async () => {
      const catalogue = await getPlanCatalogue();

      expect(catalogue.subscriptions.map((plan) => plan.id)).toEqual([
        "free",
        "starter",
        "pro",
      ]);
      expect(catalogue.oneTimeProducts.map((product) => product.id)).toEqual([
        "credits",
        "lifetime_pro",
      ]);
    });

    it("exposes the plan a one-time product grants", async () => {
      const lifetime = await getOneTimeProduct("lifetime_pro");

      expect(lifetime.price).toBe(199);
      expect(lifetime.grantsPlanId).toBe("pro");
    });

    it("lifts credit-pack sizing out of the credits row limits", async () => {
      await expect(getCreditPackConfig()).resolves.toEqual({
        creditsPerPack: 1000,
        maxPacksPerPurchase: 100,
        pricePerPack: 19,
      });
    });
  });

  describe("caching", () => {
    it("queries once no matter how many callers read the catalogue", async () => {
      await Promise.all([
        getPlanCatalogue(),
        getPlanCatalogue(),
        getPaidPlan("pro"),
      ]);
      await getPlanCatalogue();

      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("re-queries after the cache is cleared", async () => {
      await getPlanCatalogue();
      clearPlanCatalogueCache();
      await getPlanCatalogue();

      expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("does not cache a failure", async () => {
      selectMock.mockResolvedValueOnce({
        data: null,
        error: { message: "connection reset" },
      });

      await expect(getPlanCatalogue()).rejects.toThrow("connection reset");

      respondWith(FULL_SEED);
      await expect(getPlanCatalogue()).resolves.toBeDefined();
    });
  });

  describe("validation", () => {
    it("refuses a catalogue missing a plan the type system promises exists", async () => {
      respondWith([FREE_ROW, STARTER_ROW, CREDITS_ROW, LIFETIME_ROW]);

      await expect(getPlanCatalogue()).rejects.toThrow(
        /missing active row\(s\): pro/,
      );
    });

    it("refuses an empty table rather than gating everyone to nothing", async () => {
      respondWith([]);

      await expect(getPlanCatalogue()).rejects.toThrow(/plans table is empty/);
    });

    it("refuses a subscription row missing a limit the gates read", async () => {
      respondWith([
        FREE_ROW,
        STARTER_ROW,
        planRow({
          limits: {
            websites: 5,
            collaborators: 5,
            ai_features: true,
            translations: -1,
            ab_testing: true,
          },
        }),
        CREDITS_ROW,
        LIFETIME_ROW,
      ]);

      await expect(getPlanCatalogue()).rejects.toThrow(
        /limits\.monthly_credits for "pro" is not a number/,
      );
    });

    it("refuses a features column that is not an array of strings", async () => {
      respondWith([
        FREE_ROW,
        STARTER_ROW,
        planRow({ features: [42] }),
        CREDITS_ROW,
        LIFETIME_ROW,
      ]);

      await expect(getPlanCatalogue()).rejects.toThrow(
        /contains a non-string entry/,
      );
    });

    it("throws on an unknown paid plan instead of falling back to free", async () => {
      await expect(getPaidPlan("gold" as unknown as "pro")).rejects.toThrow(
        "Unknown plan: gold",
      );
    });

    it("falls back to free for a retired plan id on an old subscription row", async () => {
      const plan = await getPlanForSubscriber("enterprise");

      expect(plan.id).toBe("free");
    });
  });

  describe("price helpers", () => {
    it("shows the monthly-equivalent price for each period", async () => {
      await expect(getPlanDisplayPrice("pro", "monthly")).resolves.toBe(19);
      await expect(getPlanDisplayPrice("pro", "yearly")).resolves.toBe(15.77);
    });

    it("bills twelve monthly-equivalents once a year, rounded to cents", async () => {
      await expect(getPlanCyclePrice("pro", "yearly")).resolves.toBe(189.24);
      await expect(getPlanCyclePrice("pro", "monthly")).resolves.toBe(19);
    });
  });

  describe("Stripe price id resolution", () => {
    it("reads the environment when the row has no override", async () => {
      await expect(resolveStripePriceId("pro", "monthly")).resolves.toBe(
        "price_pro_monthly",
      );
      await expect(resolveStripePriceId("pro", "yearly")).resolves.toBe(
        "price_pro_yearly",
      );
      await expect(resolveOneTimePriceId("lifetime_pro")).resolves.toBe(
        "price_lifetime",
      );
    });

    it("prefers a populated column over the environment", async () => {
      respondWith([
        FREE_ROW,
        STARTER_ROW,
        planRow({ stripe_price_id_test: "price_promo_override" }),
        CREDITS_ROW,
        LIFETIME_ROW,
      ]);

      await expect(resolveStripePriceId("pro", "monthly")).resolves.toBe(
        "price_promo_override",
      );
    });

    it("names the variable to set when no price is configured anywhere", async () => {
      delete process.env.STRIPE_PRO_YEARLY_PRICE_ID;

      await expect(resolveStripePriceId("pro", "yearly")).rejects.toThrow(
        /STRIPE_PRO_YEARLY_PRICE_ID/,
      );
    });
  });

  describe("plan identity", () => {
    it("accepts only the paid plan ids", () => {
      expect(PAID_PLAN_IDS).toEqual(["starter", "pro"]);
      expect(isPaidPlanId("pro")).toBe(true);
      expect(isPaidPlanId("free")).toBe(false);
      expect(isPaidPlanId("enterprise")).toBe(false);
      expect(isPaidPlanId(null)).toBe(false);
    });
  });
});

/**
 * Client-side plan lookup.
 *
 * UsageCard used to index a frozen SUBSCRIPTION_PLANS map by `plan_id` with no
 * fallback and immediately read `.limits.websites`, so any account holding a
 * plan id the code did not know about white-screened its own billing page. Now
 * that plans come from the database an unknown id is MORE likely, not less —
 * a row can be deactivated or renamed without a deploy.
 */
describe("findSubscriptionPlan", () => {
  const catalogue = {
    subscriptions: [
      {
        id: "free" as const,
        name: "Free",
        description: "No active subscription",
        price: 0,
        yearlyPrice: 0,
        features: [],
        limits: {
          websites: 0,
          collaborators: 0,
          aiFeatures: false,
          translations: 0,
          abTesting: false,
          monthlyCredits: 0,
        },
        additionalSitePrice: null,
        sortOrder: 0,
      },
      {
        id: "pro" as const,
        name: "Pro",
        description: "Up to 5 websites",
        price: 19,
        yearlyPrice: 15.77,
        features: [],
        limits: {
          websites: 5,
          collaborators: 5,
          aiFeatures: true,
          translations: -1,
          abTesting: true,
          monthlyCredits: 500,
        },
        additionalSitePrice: 5,
        sortOrder: 20,
      },
    ],
    oneTimeProducts: [],
    creditPack: {
      creditsPerPack: 1000,
      maxPacksPerPurchase: 100,
      pricePerPack: 19,
    },
  };

  it("returns the matching plan", () => {
    expect(findSubscriptionPlan(catalogue, "pro")?.id).toBe("pro");
  });

  it.each([
    ["a retired plan", "enterprise"],
    ["a typo", "prro"],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to free for %s rather than returning undefined", (_l, id) => {
    expect(findSubscriptionPlan(catalogue, id)?.id).toBe("free");
  });

  it("returns undefined only when the catalogue itself has no free plan", () => {
    // Nothing sensible is left to render at that point, and the caller must
    // show an error rather than a plausible-looking wrong plan.
    const broken = { ...catalogue, subscriptions: [catalogue.subscriptions[1]] };
    expect(findSubscriptionPlan(broken, "enterprise")).toBeUndefined();
  });
});

describe("sellablePlans", () => {
  it("excludes free, which is the absence of a subscription rather than a SKU", async () => {
    const catalogue = await getPlanCatalogue();
    expect(sellablePlans(catalogue).map((p) => p.id)).toEqual([
      "starter",
      "pro",
    ]);
  });
});
