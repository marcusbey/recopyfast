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
 * STRIPE_CONFIG reads process.env at module-evaluation time, so each case
 * resets the module registry and re-imports rather than mutating a cached
 * value.
 */

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
  describe("development", () => {
    it("returns the secret when STRIPE_WEBHOOK_SECRET is set", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "whsec_a_real_looking_secret",
      });

      expect(requireWebhookSecret()).toBe("whsec_a_real_looking_secret");
    });

    it("throws when STRIPE_WEBHOOK_SECRET is an empty string", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "",
      });

      expect(() => requireWebhookSecret()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it("throws when STRIPE_WEBHOOK_SECRET is entirely whitespace", async () => {
      // A whitespace-only value is just as dangerous as "": it is truthy, so a
      // plain `if (!secret)` check would let it through, yet it is not a real
      // signing key.
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "development",
        STRIPE_WEBHOOK_SECRET: "   ",
      });

      expect(() => requireWebhookSecret()).toThrow();
    });

    it("throws when STRIPE_WEBHOOK_SECRET is undefined", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "development",
        STRIPE_WEBHOOK_SECRET: undefined,
      });

      expect(() => requireWebhookSecret()).toThrow();
    });
  });

  describe("production", () => {
    it("reads the _LIVE variable, not the test one", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value_must_not_be_used",
        STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_value",
      });

      expect(requireWebhookSecret()).toBe("whsec_live_value");
    });

    it("throws when the _LIVE secret is empty even if the test one is set", async () => {
      // The exact production hazard: the test variable being populated must not
      // mask an unset live secret.
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_test_value_is_set",
        STRIPE_WEBHOOK_SECRET_LIVE: "",
      });

      expect(() => requireWebhookSecret()).toThrow(
        /STRIPE_WEBHOOK_SECRET_LIVE/,
      );
    });

    it("names the live variable in the error so the fix is unambiguous", async () => {
      const { requireWebhookSecret } = await loadConfig({
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET_LIVE: undefined,
      });

      expect(() => requireWebhookSecret()).toThrow(
        /STRIPE_WEBHOOK_SECRET_LIVE is not set/,
      );
    });
  });

  it("explains why an empty secret is refused", async () => {
    // The message is the only thing an on-call engineer sees at 3am; it must say
    // why rather than just what.
    const { requireWebhookSecret } = await loadConfig({
      NODE_ENV: "development",
      STRIPE_WEBHOOK_SECRET: "",
    });

    expect(() => requireWebhookSecret()).toThrow(/forged/i);
  });
});
