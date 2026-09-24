const PRODUCTION_PROJECT_REF = "uexwowziiigweobgpmtk";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type Environment = Record<string, string | undefined>;

export interface StripeProviderEnvironment {
  appUrl: string;
  priceId: string;
  publishableKey: string;
  secretKey: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
  webhookSecret: string;
}

interface StripePriceEvidence {
  id: string;
  active: boolean;
  livemode: boolean;
  currency: string;
  recurring: { interval?: string } | null;
  type: string;
}

function refusal(reason: string): never {
  throw new Error(`Refusing Stripe provider E2E: ${reason}`);
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value) refusal(`${name} is required.`);
  return value;
}

function exactLoopbackOrigin(
  env: Environment,
  name: string,
  port: string,
): string {
  const value = required(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    refusal(`${name} is not a valid URL.`);
  }

  const isUnsafe =
    parsed.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.port !== port ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "";

  if (isUnsafe) {
    refusal(`${name} must be an exact loopback HTTP origin on port ${port}.`);
  }
  return parsed.origin;
}

function decodedJwtPayload(value: string): string {
  const segments = value.split(".");
  if (segments.length !== 3) return "";
  try {
    return Buffer.from(segments[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function testCredential(
  env: Environment,
  name: string,
  prefix: "sk_test_" | "pk_test_",
): string {
  const value = required(env, name);
  if (!value.startsWith(prefix) || /placeholder/i.test(value)) {
    refusal(`${name} must be a non-placeholder Stripe test credential.`);
  }
  return value;
}

/**
 * This lane can create Auth rows, Stripe customers and subscriptions. The s25
 * proof is deliberately stricter than ordinary local development: every
 * mutable target must be the deterministic s24 loopback stack, Stripe's mode
 * selectors must be unable to choose live, and no placeholder credential may
 * survive far enough to make a provider request. Keep this check at the top of
 * both the operator runner and the Playwright fixture; a shell script alone is
 * not an authorization boundary because the spec can be invoked directly.
 */
export function assertStripeProviderEnvironment(
  env: Environment = process.env,
): StripeProviderEnvironment {
  if (env.RUN_RECOPYFAST_STRIPE_E2E !== "1") {
    refusal("RUN_RECOPYFAST_STRIPE_E2E must equal 1.");
  }
  if (env.STRIPE_LIVE_MODE === "true" || env.VERCEL_ENV === "production") {
    refusal("the application is configured to select Stripe live mode.");
  }

  const supabaseUrl = exactLoopbackOrigin(
    env,
    "NEXT_PUBLIC_SUPABASE_URL",
    "54321",
  );
  const appUrl = exactLoopbackOrigin(env, "PLAYWRIGHT_BASE_URL", "3000");
  const configuredAppUrl = exactLoopbackOrigin(
    env,
    "NEXT_PUBLIC_APP_URL",
    "3000",
  );
  if (configuredAppUrl !== appUrl) {
    refusal("NEXT_PUBLIC_APP_URL must equal PLAYWRIGHT_BASE_URL exactly.");
  }

  const supabaseAnonKey = required(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const serviceRoleEvidence = `${supabaseServiceRoleKey}\n${decodedJwtPayload(supabaseServiceRoleKey)}`;
  if (serviceRoleEvidence.includes(PRODUCTION_PROJECT_REF)) {
    refusal("the service-role credential names the production project.");
  }

  const secretKey = testCredential(env, "STRIPE_SECRET_KEY", "sk_test_");
  const publishableKey = testCredential(
    env,
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "pk_test_",
  );
  const webhookSecret = required(env, "STRIPE_WEBHOOK_SECRET");
  if (
    !webhookSecret.startsWith("whsec_") ||
    /placeholder/i.test(webhookSecret)
  ) {
    refusal(
      "STRIPE_WEBHOOK_SECRET must be the ephemeral non-placeholder Stripe CLI signing secret.",
    );
  }
  const priceId = required(env, "STRIPE_PRO_PRICE_ID");
  if (!priceId.startsWith("price_") || /placeholder/i.test(priceId)) {
    refusal("STRIPE_PRO_PRICE_ID must name a non-placeholder Stripe Price.");
  }

  return {
    appUrl,
    priceId,
    publishableKey,
    secretKey,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    supabaseUrl,
    webhookSecret,
  };
}

/** Verify the provider object itself, not only the environment variable name. */
export function assertStripeProviderPrice(
  price: StripePriceEvidence,
  configuredPriceId: string,
): void {
  const isExpectedTestSubscription =
    price.id === configuredPriceId &&
    price.active === true &&
    price.livemode === false &&
    price.currency === "usd" &&
    price.type === "recurring" &&
    price.recurring?.interval === "month";

  if (!isExpectedTestSubscription) {
    refusal(
      "the configured Pro Price is not the active monthly USD test-mode subscription object.",
    );
  }
}
