/**
 * requireWebhookSecret — the guard that stops an unset signing secret from
 * authenticating forged Stripe webhooks.
 *
 * Background: stripe.webhooks.constructEvent does NOT reject an empty-string
 * key. It computes HMAC-SHA256("", payload), so a caller who signs with ""
 * produces a signature that verifies. This was reproduced against the running
 * route: signing with "" returned 200 and reached the handler, while signing
 * with a wrong non-empty secret returned 400.
 *
 * The live/test discriminator is VERCEL_ENV, NOT NODE_ENV. Vercel sets
 * NODE_ENV=production on preview builds too, so keying on it pointed every PR
 * preview at the live Stripe account. These cases pin the new contract,
 * including the one that used to be wrong: NODE_ENV=production with VERCEL_ENV
 * unset must resolve to TEST.
 *
 * Each case resets the module registry and re-imports rather than mutating a
 * cached value.
 */

// Both suites in this directory load their subject with a dynamic import(),
// so without this marker TypeScript treats the file as a global script and
// their identically-named top-level constants collide.
export {};

const ORIGINAL_ENV = process.env;

async function loadConfig(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import("../config");
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
});

describe("requireWebhookSecret", () => {
  describe("secret validation", () => {
    it("returns the secret when STRIPE_WEBHOOK_SECRET is set", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "whsec_a_real_looking_secret",
      });

      expect(requireWebhookSecret()).toBe("whsec_a_real_looking_secret");
    });

    it("throws when STRIPE_WEBHOOK_SECRET is an empty string", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "",
      });

      expect(() => requireWebhookSecret()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it("throws when STRIPE_WEBHOOK_SECRET is entirely whitespace", async () => {
      // A whitespace-only value is just as dangerous as "": it is truthy, so a
      // plain `if (!secret)` check would let it through, yet it is not a real
      // signing key.
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "   ",
      });

      expect(() => requireWebhookSecret()).toThrow();
    });

    it("throws when STRIPE_WEBHOOK_SECRET is undefined", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "development",
        STRIPE_WEBHOOK_SECRET: undefined,
      });

      expect(() => requireWebhookSecret()).toThrow();
    });
  });

  describe("live mode (VERCEL_ENV=production)", () => {
    it("reads the _LIVE variable, not the test one", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value_must_not_be_used",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value",
      });

      expect(requireWebhookSecret()).toBe("whsec_live_value");
    });

    it("throws when the _LIVE secret is empty even if the test one is set", async () => {
      // The exact production hazard: the test variable being populated must not
      // mask an unset live secret.
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value_is_set",
        STRIPE_WEBHOOK_SECRET_LIVE: "",
      });

      expect(() => requireWebhookSecret()).toThrow(
        /STRIPE_WEBHOOK_SECRET_LIVE/,
      );
    });

    it("names the live variable in the error so the fix is unambiguous", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "production",
        STRIPE_WEBHOOK_SECRET_LIVE: undefined,
      });

      expect(() => requireWebhookSecret()).toThrow(
        /STRIPE_WEBHOOK_SECRET_LIVE is not set/,
      );
    });
  });

  describe("test mode", () => {
    // THE REGRESSION THIS FILE EXISTS TO PREVENT. `next build` sets
    // NODE_ENV=production on Vercel PREVIEW deployments, so keying live mode on
    // it meant every pull-request preview resolved live Stripe credentials and
    // could take real money off a real card.
    it("stays on TEST when NODE_ENV is production but VERCEL_ENV is unset", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "production",
        VERCEL_ENV: undefined,
        STRIPE_WEBHOOK_SECRET: "whsec_test_value",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value_must_not_be_used",
      });

      expect(requireWebhookSecret()).toBe("whsec_test_value");
    });

    it("stays on TEST for a preview deployment", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value_must_not_be_used",
      });

      expect(requireWebhookSecret()).toBe("whsec_test_value");
    });

    it("stays on TEST for a development deployment", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value_must_not_be_used",
      });

      expect(requireWebhookSecret()).toBe("whsec_test_value");
    });

    it("names the test variable when it is the one missing", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: "preview",
        STRIPE_WEBHOOK_SECRET: undefined,
      });

      expect(() => requireWebhookSecret()).toThrow(
        /STRIPE_WEBHOOK_SECRET is not set/,
      );
    });
  });

  describe("explicit override for non-Vercel hosts", () => {
    // A self-hosted production deployment has no VERCEL_ENV and would otherwise
    // be stuck in test mode forever, unable to take real payments.
    it('goes live when STRIPE_LIVE_MODE is exactly "true"', async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: undefined,
        STRIPE_LIVE_MODE: "true",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value",
      });

      expect(requireWebhookSecret()).toBe("whsec_live_value");
    });

    it("does not go live on a merely truthy value", async () => {
      const { requireWebhookSecret } = await loadConfig({
        VERCEL_ENV: undefined,
        STRIPE_LIVE_MODE: "1",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value_must_not_be_used",
      });

      expect(requireWebhookSecret()).toBe("whsec_test_value");
    });
  });

  it("explains why an empty secret is refused", async () => {
    // The message is the only thing an on-call engineer sees at 3am; it must say
    // why rather than just what.
    const { requireWebhookSecret } = await loadConfig({
      VERCEL_ENV: "development",
      STRIPE_WEBHOOK_SECRET: "",
    });

    expect(() => requireWebhookSecret()).toThrow(/forged/i);
  });
});
