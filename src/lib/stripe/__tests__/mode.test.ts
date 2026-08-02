/**
 * The live/test discriminator.
 *
 * This is the single highest-consequence boolean in the codebase: getting it
 * wrong once meant every pull-request preview transacted against the live
 * Stripe account. The cases below pin both directions — what must be live, and
 * more importantly what must NOT be.
 */

// Both suites in this directory load their subject with a dynamic import(),
// so without this marker TypeScript treats the file as a global script and
// their identically-named top-level constants collide.
export {};

const ORIGINAL_ENV = process.env;

async function loadMode(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import("../mode");
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
});

describe("isLiveMode", () => {
  it("is live only for a production Vercel deployment", async () => {
    const { isLiveMode } = await loadMode({ VERCEL_ENV: "production" });
    expect(isLiveMode()).toBe(true);
  });

  it.each([
    ["preview", "preview"],
    ["development", "development"],
    ["an unrecognised value", "staging"],
  ])("is test for %s", async (_label, vercelEnv) => {
    const { isLiveMode } = await loadMode({ VERCEL_ENV: vercelEnv });
    expect(isLiveMode()).toBe(false);
  });

  it("is test when VERCEL_ENV is absent entirely", async () => {
    const { isLiveMode } = await loadMode({
      VERCEL_ENV: undefined,
      STRIPE_LIVE_MODE: undefined,
    });
    expect(isLiveMode()).toBe(false);
  });

  // THE BUG. Vercel sets NODE_ENV=production when it runs `next build`, which
  // it does for preview deployments too. Keying on it charged real cards from
  // throwaway PR environments.
  it("is TEST when NODE_ENV is production but VERCEL_ENV is not", async () => {
    const { isLiveMode } = await loadMode({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      STRIPE_LIVE_MODE: undefined,
    });
    expect(isLiveMode()).toBe(false);
  });

  describe("STRIPE_LIVE_MODE override", () => {
    it("forces live for a non-Vercel production host", async () => {
      const { isLiveMode } = await loadMode({
        VERCEL_ENV: undefined,
        STRIPE_LIVE_MODE: "true",
      });
      expect(isLiveMode()).toBe(true);
    });

    it.each(["1", "yes", "TRUE", ""])(
      "ignores the merely-truthy value %p",
      async (value) => {
        const { isLiveMode } = await loadMode({
          VERCEL_ENV: undefined,
          STRIPE_LIVE_MODE: value,
        });
        expect(isLiveMode()).toBe(false);
      },
    );
  });
});

describe("selectByMode", () => {
  it("picks the live member in live mode", async () => {
    const { selectByMode } = await loadMode({ VERCEL_ENV: "production" });
    expect(selectByMode({ test: "t", live: "l" })).toBe("l");
  });

  it("picks the test member everywhere else", async () => {
    const { selectByMode } = await loadMode({ VERCEL_ENV: "preview" });
    expect(selectByMode({ test: "t", live: "l" })).toBe("t");
  });

  it("preserves undefined members rather than coercing them", async () => {
    const { selectByMode } = await loadMode({ VERCEL_ENV: "preview" });
    expect(
      selectByMode<string | undefined>({ test: undefined, live: "l" }),
    ).toBeUndefined();
  });
});

describe("stripeEnvVar", () => {
  it("reports the variable name it consulted, so errors can name the fix", async () => {
    const { stripeEnvVar } = await loadMode({
      VERCEL_ENV: "production",
      STRIPE_PRO_PRICE_ID_LIVE: "price_live",
    });

    expect(
      stripeEnvVar({
        test: "STRIPE_PRO_PRICE_ID",
        live: "STRIPE_PRO_PRICE_ID_LIVE",
      }),
    ).toEqual({
      name: "STRIPE_PRO_PRICE_ID_LIVE",
      value: "price_live",
    });
  });

  it("reports the name even when the variable is unset", async () => {
    const { stripeEnvVar } = await loadMode({
      VERCEL_ENV: "preview",
      STRIPE_PRO_PRICE_ID: undefined,
    });

    expect(
      stripeEnvVar({
        test: "STRIPE_PRO_PRICE_ID",
        live: "STRIPE_PRO_PRICE_ID_LIVE",
      }),
    ).toEqual({ name: "STRIPE_PRO_PRICE_ID", value: undefined });
  });
});

describe("describeStripeMode", () => {
  it("attributes the decision to VERCEL_ENV", async () => {
    const { describeStripeMode } = await loadMode({ VERCEL_ENV: "preview" });
    expect(describeStripeMode()).toBe("test (VERCEL_ENV=preview)");
  });

  it("says <unset> rather than undefined when VERCEL_ENV is absent", async () => {
    const { describeStripeMode } = await loadMode({
      VERCEL_ENV: undefined,
      STRIPE_LIVE_MODE: undefined,
    });
    expect(describeStripeMode()).toBe("test (VERCEL_ENV=<unset>)");
  });

  it("attributes an override to STRIPE_LIVE_MODE", async () => {
    const { describeStripeMode } = await loadMode({
      VERCEL_ENV: undefined,
      STRIPE_LIVE_MODE: "true",
    });
    expect(describeStripeMode()).toBe("live (STRIPE_LIVE_MODE=true)");
  });

  it("never leaks a key or a price id", async () => {
    const { describeStripeMode } = await loadMode({
      VERCEL_ENV: "production",
      STRIPE_SECRET_KEY_LIVE: "sk_live_supersecret",
    });
    expect(describeStripeMode()).not.toContain("sk_live");
  });
});
