import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const JANITOR = resolve(ROOT, "scripts/stripe-provider-janitor.ts");

const SAFE_SHAPES = {
  RUN_RECOPYFAST_STRIPE_E2E: "1",
  STRIPE_PROVIDER_RUN_ID: "run-entry-guard",
  STRIPE_PROVIDER_AUTH_USER_ID: "00000000-0000-4000-8000-000000000025",
  STRIPE_PROVIDER_USER_EMAIL: "s25-entry@recopyfast.invalid",
  STRIPE_PROVIDER_STARTED_AT_UNIX: "1000",
  STRIPE_PROVIDER_JANITOR_STATE_FILE: resolve(
    ROOT,
    "test-results/stripe-provider-janitor-state-run-entry.json",
  ),
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  STRIPE_SECRET_KEY: "sk_test_operator_key",
  STRIPE_WEBHOOK_SECRET: "whsec_operator_secret",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_operator_key",
  STRIPE_PRO_PRICE_ID: "price_test_pro_monthly",
  STRIPE_LIVE_MODE: "false",
  VERCEL_ENV: "development",
};

describe("external Stripe provider janitor entry guard", () => {
  it.each([
    ["missing explicit opt-in", { RUN_RECOPYFAST_STRIPE_E2E: "0" }],
    [
      "non-loopback Supabase",
      { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
    ],
    ["live Stripe secret", { STRIPE_SECRET_KEY: "sk_live_operator_key" }],
  ])(
    "refuses %s before any client can reach a provider",
    (_label, override) => {
      const result = spawnSync(TSX, [JANITOR], {
        cwd: ROOT,
        env: { ...process.env, ...SAFE_SHAPES, ...override },
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/refusing stripe provider e2e/i);
      expect(result.stderr).not.toMatch(/ECONNREFUSED|api\.stripe\.com/i);
    },
  );
});
