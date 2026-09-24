import {
  assertStripeProviderEnvironment,
  assertStripeProviderPrice,
} from "../../../e2e/support/stripe-provider-guard";

const SAFE_ENV = {
  RUN_RECOPYFAST_STRIPE_E2E: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  STRIPE_SECRET_KEY: "sk_test_operator_key",
  STRIPE_WEBHOOK_SECRET: "whsec_operator_secret",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_operator_key",
  STRIPE_PRO_PRICE_ID: "price_test_pro_monthly",
  STRIPE_LIVE_MODE: undefined,
  VERCEL_ENV: undefined,
};

describe("assertStripeProviderEnvironment", () => {
  it("accepts only the explicit local test-mode operator lane", () => {
    expect(assertStripeProviderEnvironment(SAFE_ENV)).toEqual({
      appUrl: "http://127.0.0.1:3000",
      priceId: "price_test_pro_monthly",
      publishableKey: "pk_test_operator_key",
      secretKey: "sk_test_operator_key",
      supabaseAnonKey: "local-anon-key",
      supabaseServiceRoleKey: "local-service-role-key",
      supabaseUrl: "http://127.0.0.1:54321",
      webhookSecret: "whsec_operator_secret",
    });
  });

  it.each([
    ["missing opt-in", { RUN_RECOPYFAST_STRIPE_E2E: undefined }],
    ["live override", { STRIPE_LIVE_MODE: "true" }],
    ["Vercel production", { VERCEL_ENV: "production" }],
    ["live secret", { STRIPE_SECRET_KEY: "sk_live_operator_key" }],
    ["placeholder secret", { STRIPE_SECRET_KEY: "sk_test_placeholder" }],
    [
      "placeholder webhook secret",
      { STRIPE_WEBHOOK_SECRET: "whsec_placeholder" },
    ],
    [
      "live publishable key",
      { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_operator_key" },
    ],
    [
      "placeholder publishable key",
      { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder" },
    ],
    ["placeholder price", { STRIPE_PRO_PRICE_ID: "price_placeholder" }],
    [
      "hosted Supabase",
      { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    ],
    ["production app", { PLAYWRIGHT_BASE_URL: "https://www.recopyfa.st" }],
    [
      "mismatched return origin",
      { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
    ],
  ])("rejects %s before provider access", (_label, override) => {
    expect(() =>
      assertStripeProviderEnvironment({ ...SAFE_ENV, ...override }),
    ).toThrow(/refusing stripe provider e2e/i);
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PLAYWRIGHT_BASE_URL",
    "NEXT_PUBLIC_APP_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_PRO_PRICE_ID",
  ] as const)("rejects a missing %s", (name) => {
    expect(() =>
      assertStripeProviderEnvironment({ ...SAFE_ENV, [name]: undefined }),
    ).toThrow(/refusing stripe provider e2e/i);
  });
});

describe("assertStripeProviderPrice", () => {
  const SAFE_PRICE = {
    id: "price_test_pro_monthly",
    active: true,
    livemode: false,
    currency: "usd",
    recurring: { interval: "month" },
    type: "recurring",
  };

  it("accepts the configured active monthly test subscription price", () => {
    expect(() =>
      assertStripeProviderPrice(SAFE_PRICE, "price_test_pro_monthly"),
    ).not.toThrow();
  });

  it.each([
    ["different object", { id: "price_other" }],
    ["live object", { livemode: true }],
    ["inactive object", { active: false }],
    ["one-time object", { type: "one_time", recurring: null }],
    ["yearly object", { recurring: { interval: "year" } }],
    ["wrong currency", { currency: "cad" }],
  ])("rejects a %s", (_label, override) => {
    expect(() =>
      assertStripeProviderPrice(
        { ...SAFE_PRICE, ...override },
        "price_test_pro_monthly",
      ),
    ).toThrow(/refusing stripe provider e2e/i);
  });
});
