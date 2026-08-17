/**
 * The seeded catalogue must match what the product actually sells.
 *
 * These assertions read the migration rather than the loader: the loader is
 * only ever as right as the row behind it, and the numbers below (Pro's five
 * included sites at $5 each, Credits at $19, Lifetime Pro at $199 granting Pro)
 * are commercial commitments, not implementation details.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260802000000_plans_catalog.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

/** The VALUES tuple for one seeded plan, from its quoted id to the closing paren. */
function seedRow(planId: string): string {
  const marker = `'${planId}', '`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("\n  )", start));
}

describe("plans seed", () => {
  it("ships exactly the three subscription plans", () => {
    expect(seedRow("free")).toContain("'subscription'");
    expect(seedRow("starter")).toContain("'subscription'");
    expect(seedRow("pro")).toContain("'subscription'");
  });

  it("retires Enterprise instead of leaving it on sale", () => {
    expect(sql).toMatch(
      /UPDATE plans SET is_active = FALSE[\s\S]*WHERE id = 'enterprise'/,
    );
    // No active Enterprise row is inserted anywhere in the seed.
    expect(sql).not.toMatch(/\(\s*'enterprise', 'subscription'/);
  });

  it("gives Starter one website and no overage", () => {
    const row = seedRow("starter");

    expect(row).toContain('"websites": 1');
    expect(row).toMatch(/NULL, NULL, TRUE/);
  });

  it("gives Pro five websites at $5 for each additional site", () => {
    const row = seedRow("pro");

    expect(row).toContain('"websites": 5');
    // (limits, features, additional_site_price, grants_plan_id, is_active, ...)
    expect(row).toMatch(/\n\s*5, NULL, TRUE/);
    expect(row).toContain("+$5 per additional website");
  });

  it("prices Credits at $19 as a one-time product", () => {
    const row = seedRow("credits");

    expect(row).toContain("'one_time'");
    expect(row).toMatch(/\n\s*19, NULL,/);
    expect(row).toContain('"credits_per_pack": 1000');
  });

  it("prices Lifetime Pro at $199 and grants the pro plan", () => {
    const row = seedRow("lifetime_pro");

    expect(row).toContain("'one_time'");
    expect(row).toMatch(/\n\s*199, NULL,/);
    expect(row).toMatch(/NULL, 'pro', TRUE/);
  });

  it("makes the catalogue public-read and service-role-write", () => {
    expect(sql).toContain('CREATE POLICY "Anyone can view active plans"');
    expect(sql).toContain("USING (is_active = TRUE)");
    expect(sql).toContain('CREATE POLICY "Service role can manage plans"');
  });

  it("keeps entitlements writable only by the service role", () => {
    const entitlements = sql.slice(sql.indexOf("plan_entitlements"));

    expect(entitlements).toContain(
      'CREATE POLICY "Users can view their own entitlements"',
    );
    // An entitlement is worth $199, so `authenticated` gets SELECT and nothing
    // else; the grant is written by the Stripe webhook as service_role.
    expect(entitlements).toContain(
      "GRANT SELECT ON plan_entitlements TO authenticated;",
    );
    expect(entitlements).not.toMatch(/GRANT INSERT[^;]*plan_entitlements/);
  });
});

/**
 * Migration 20260817000000 — the trial is a time-boxed row in the SAME grant
 * table lifetime purchases use, not a new plan (ADR 014).
 *
 * Read from the migration text for the same reason as the seed above: the
 * partial unique index is the ONLY thing enforcing "one trial per account,
 * ever" (AC 6). It is not an application check that a future refactor can move
 * — if it is not in the DDL, the guarantee does not exist.
 */
describe("trial entitlement migration", () => {
  const trialSql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260817000000_trial_entitlements.sql",
    ),
    "utf8",
  );

  it("widens plan_entitlements with a nullable expiry", () => {
    expect(trialSql).toMatch(
      /ALTER TABLE\s+(public\.)?plan_entitlements\s+ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ/,
    );
    // NULL has to keep meaning "never expires", or every existing lifetime
    // grant would need a backfill and a missed one would revoke a $199 sale.
    expect(trialSql).not.toMatch(/expires_at TIMESTAMPTZ\s+NOT NULL/);
  });

  it("enforces one trial per account in Postgres, not in application code", () => {
    expect(trialSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+plan_entitlements_one_trial_per_user/,
    );
    expect(trialSql).toMatch(
      /ON\s+(public\.)?plan_entitlements\s*\(user_id\)\s*WHERE source = 'trial'/,
    );
  });

  it("does not add a trial row to the plan catalogue", () => {
    // A `trial` id is outside the SubscriptionPlanId/OneTimeProductId unions,
    // and loadPlanCatalogue maps every active row before returning any of them
    // — so one such row takes down pricing, checkout and every feature gate at
    // once, not just the pricing feed. See ADR 014.
    expect(trialSql).not.toMatch(/INSERT INTO plans/i);
  });

  it("leaves the applied catalogue migration untouched", () => {
    // Forward-only: 20260802000000 is applied in production, so the expiry
    // column must arrive in a new file rather than by editing that one.
    expect(sql).not.toContain("expires_at");
    expect(sql).not.toContain("one_trial_per_user");
  });
});

/**
 * Migration 20260802020000 — the two defects that ended with a customer paying
 * and receiving nothing.
 */
describe("plan constraint and credit collapse migration", () => {
  const constraintSql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260802020000_plan_constraint_and_credit_collapse.sql",
    ),
    "utf8",
  );

  it("allows starter on billing_subscriptions.plan", () => {
    // The original CHECK was ('free','pro','enterprise'), so every Starter
    // checkout raised 23514, the webhook 500'd, and Stripe retried forever
    // while the customer's card had already been charged.
    expect(constraintSql).toContain(
      "CHECK (plan IN ('free', 'starter', 'pro'))",
    );
  });

  it("grandfathers Enterprise subscribers to Pro before the constraint changes", () => {
    const grandfather = constraintSql.indexOf("SET plan = 'pro'");
    const newConstraint = constraintSql.indexOf(
      "billing_subscriptions_plan_valid",
    );

    expect(grandfather).toBeGreaterThan(-1);
    // Ordering is load-bearing: adding the constraint first would fail against
    // any surviving enterprise row and abort the whole migration.
    expect(grandfather).toBeLessThan(newConstraint);
  });

  it("carries existing ticket balances into credit_purchases", () => {
    expect(constraintSql).toContain("INSERT INTO credit_purchases");
    expect(constraintSql).toContain("FROM tickets t");
    expect(constraintSql).toContain("WHERE t.balance > 0");
    // Re-runnable, and the synthetic key can never collide with a real Stripe
    // payment intent (always prefixed `pi_`).
    expect(constraintSql).toContain(
      "ON CONFLICT (stripe_payment_intent_id) DO NOTHING",
    );
    expect(constraintSql).toContain("'migrated_wallet_'");
  });

  it("makes purchased credits non-expiring", () => {
    expect(constraintSql).toContain(
      "ALTER TABLE credit_purchases ALTER COLUMN expires_at DROP NOT NULL",
    );
  });

  it("does not drop the tickets tables in the same migration that copies out of them", () => {
    // They are the historical record of what was bought, and dropping them here
    // would leave no way back if the copy above is wrong.
    expect(constraintSql).not.toMatch(/DROP TABLE\s+(IF EXISTS\s+)?tickets/i);
  });
});
