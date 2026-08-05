#!/usr/bin/env node
/**
 * Keeps what Stripe tells a customer in step with what the `plans` table says.
 *
 * Why this exists: at the exact moment a customer handed over a card, Stripe
 * Checkout described Pro as "Up to 3 websites, all features, $6 per additional
 * website" while the app and the landing page both said 5 websites and +$5.
 * In live mode it was worse — Pro read "unlimited websites", which we do not
 * sell. Nobody had lied on purpose; the catalogue moved into the database and
 * Stripe's copy stayed where it was written by hand, months earlier.
 *
 * A one-off correction would have drifted again the next time pricing changed,
 * so the fix is a direction of flow: `plans` is the source of truth, Stripe is
 * a projection of it, and this script is the projection. Run it after any
 * pricing change and the two cannot disagree for long.
 *
 * It also checks the money. A price's amount is immutable at Stripe, so a
 * changed `price_monthly` cannot be pushed — it needs a NEW price and a new id
 * in the environment. That is precisely the mistake worth catching loudly:
 * silently charging last quarter's price is worse than any wrong description.
 *
 * Usage:
 *   node scripts/sync-stripe-catalogue.mjs --mode=test           # report only
 *   node scripts/sync-stripe-catalogue.mjs --mode=test --apply
 *   node scripts/sync-stripe-catalogue.mjs --mode=live           # report only
 *   node scripts/sync-stripe-catalogue.mjs --mode=live --apply
 *
 * Dry run is the default in both modes: --apply is the only thing that writes.
 * Exits non-zero when anything is out of sync (dry run) or fails (apply), so it
 * can gate a deploy.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The brand prefix belongs at Stripe and not in the catalogue: `plans.name` is
 * "Pro" because the app renders it beside its own logo, while the Stripe
 * product name is what lands on a receipt and a bank statement, where "Pro"
 * alone tells the customer nothing about who charged them.
 */
const BRAND = "RecopyFast";

/**
 * Which env var carries which price id, mirroring PRICE_ID_ENV_VARS in
 * src/lib/stripe/plans.ts. Duplicated rather than imported because that module
 * is TypeScript and opens a Supabase client on import; the shapes are checked
 * against each other by scripts/__tests__ rather than by the type system.
 */
const PRICE_ENV = {
  starter: {
    monthly: { test: "STRIPE_STARTER_PRICE_ID", live: "STRIPE_STARTER_PRICE_ID_LIVE" },
    yearly: { test: "STRIPE_STARTER_YEARLY_PRICE_ID", live: "STRIPE_STARTER_YEARLY_PRICE_ID_LIVE" },
  },
  pro: {
    monthly: { test: "STRIPE_PRO_PRICE_ID", live: "STRIPE_PRO_PRICE_ID_LIVE" },
    yearly: { test: "STRIPE_PRO_YEARLY_PRICE_ID", live: "STRIPE_PRO_YEARLY_PRICE_ID_LIVE" },
  },
  credits: {
    monthly: { test: "STRIPE_TICKETS_PRICE_ID", live: "STRIPE_TICKETS_PRICE_ID_LIVE" },
  },
  lifetime_pro: {
    monthly: { test: "STRIPE_LIFETIME_PRICE_ID", live: "STRIPE_LIFETIME_PRICE_ID_LIVE" },
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith("--mode="))?.slice("--mode=".length);
  const apply = args.includes("--apply");

  if (mode !== "test" && mode !== "live") {
    console.error(
      "Refusing to guess which Stripe account to touch.\n" +
        "  node scripts/sync-stripe-catalogue.mjs --mode=test|live [--apply]",
    );
    process.exit(2);
  }
  return { mode, apply };
}

/**
 * Reads .env without pulling in a dotenv dependency for a script that runs by
 * hand. .env.local wins, matching Next.js's own precedence, so a developer's
 * local override is not silently ignored here while it applies everywhere else.
 */
async function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = await readFile(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is not set. This script cannot run without it.`);
  }
  return value;
}

async function stripe(secretKey, endpoint, form) {
  const init = {
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
    },
  };
  if (form) {
    init.method = "POST";
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  }

  const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Stripe ${endpoint} → ${response.status}: ${body?.error?.message ?? "unknown error"}`,
    );
  }
  return body;
}

async function loadCatalogue(env) {
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const response = await fetch(
    `${url}/rest/v1/plans?select=*&is_active=eq.true&order=sort_order`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!response.ok) {
    throw new Error(`Failed to read plans: ${response.status} ${await response.text()}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("The plans table returned no active rows.");
  }
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * NUMERIC arrives from PostgREST as a string ("19.00"), and cents are what
 * Stripe compares against, so the conversion goes through Math.round rather
 * than a bare multiply — 19.99 * 100 is 1998.9999999999998.
 */
function toCents(value) {
  return Math.round(Number(value) * 100);
}

/**
 * What each configured price SHOULD look like, derived from the catalogue row.
 *
 * A yearly subscription bills twelve times the monthly-equivalent price once a
 * year, which is the same arithmetic `planCyclePrice` does for the UI; if the
 * two ever disagree, the customer sees one number and pays another.
 */
function expectationsFor(row, period) {
  const name = `${BRAND} ${row.name}`;
  const description = row.description;

  if (period === "yearly") {
    const monthlyEquivalent = row.price_yearly_monthly_equivalent ?? row.price_monthly;
    return { name, description, amount: toCents(Number(monthlyEquivalent) * 12) };
  }
  return { name, description, amount: toCents(row.price_monthly) };
}

async function main() {
  const { mode, apply } = parseArgs();
  const env = await loadEnv();
  const secretKey = requireEnv(
    env,
    mode === "live" ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY",
  );

  // A live key in a --mode=test run (or the reverse) would edit the wrong
  // account's customer-facing copy, which is not something to discover after
  // the fact.
  const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  if (!secretKey.startsWith(expectedPrefix)) {
    throw new Error(
      `--mode=${mode} expects a ${expectedPrefix}… key, but the configured key is not one. Refusing to run.`,
    );
  }

  const catalogue = await loadCatalogue(env);
  console.log(
    `\n${mode.toUpperCase()} mode · ${apply ? "APPLYING changes" : "dry run (pass --apply to write)"}\n`,
  );

  // Several prices share a product (monthly and yearly), so the product is
  // updated once and the second pass sees it already correct.
  const seenProducts = new Set();
  const drift = [];
  const blockers = [];

  for (const [planId, periods] of Object.entries(PRICE_ENV)) {
    const row = catalogue.get(planId);
    if (!row) {
      blockers.push(`plans has no active row for "${planId}", but a price is configured for it.`);
      continue;
    }

    for (const [period, envPair] of Object.entries(periods)) {
      const varName = envPair[mode];
      const priceId = env[varName];
      if (!priceId) {
        blockers.push(`${varName} is not set (${planId} ${period}).`);
        continue;
      }

      const price = await stripe(secretKey, `prices/${priceId}`);
      const expected = expectationsFor(row, period);
      const label = `${planId} ${period}`;

      if (price.livemode !== (mode === "live")) {
        blockers.push(`${varName} points at a ${price.livemode ? "live" : "test"} price in ${mode} mode.`);
        continue;
      }

      // Amounts are immutable at Stripe. Reporting rather than "fixing" is the
      // whole point: the remedy is a new price id, and doing that silently
      // would repoint checkout without anyone deciding to.
      if (price.unit_amount !== expected.amount) {
        blockers.push(
          `${label}: Stripe charges $${(price.unit_amount / 100).toFixed(2)} but the catalogue says ` +
            `$${(expected.amount / 100).toFixed(2)}. Stripe prices are immutable — create a new price and ` +
            `repoint ${varName}.`,
        );
      }

      if (seenProducts.has(price.product)) continue;
      seenProducts.add(price.product);

      const product = await stripe(secretKey, `products/${price.product}`);
      const patch = {};
      if (product.name !== expected.name) patch.name = expected.name;
      if ((product.description ?? "") !== expected.description) {
        patch.description = expected.description;
      }
      // Stamp which catalogue row this product projects, so a human in the
      // Stripe dashboard can trace a product back to its source of truth.
      //
      // Deliberately additive: it does NOT touch the existing `plan` and
      // `grant` keys. Those are hand-set and carry meaning this script has no
      // business overwriting — Lifetime Pro is `plan: pro, grant: lifetime`,
      // which says what it CONFERS, whereas `catalogue_id` says what it IS.
      // Nothing in the codebase reads product metadata (the webhook reads
      // subscription, payment_intent and session metadata, all of which
      // src/lib/stripe/checkout.ts sets itself), so this is for humans.
      if (product.metadata?.catalogue_id !== row.id) {
        patch["metadata[catalogue_id]"] = row.id;
      }

      if (Object.keys(patch).length === 0) {
        console.log(`  ✓ ${product.name} — in sync`);
        continue;
      }

      drift.push({ productId: product.id, label, product, patch });
      console.log(`  ✗ ${product.name} (${product.id})`);
      for (const [field, value] of Object.entries(patch)) {
        const current = field.startsWith("metadata")
          ? product.metadata?.catalogue_id
          : product[field];
        console.log(`      ${field}:\n        was: ${JSON.stringify(current ?? null)}\n        now: ${JSON.stringify(value)}`);
      }

      if (apply) {
        await stripe(secretKey, `products/${product.id}`, patch);
        console.log("      → updated");
      }
    }
  }

  console.log("");
  for (const blocker of blockers) console.error(`  ⚠ ${blocker}`);

  if (blockers.length > 0) {
    console.error(`\n${blockers.length} problem(s) need a human decision. Nothing above was auto-corrected.\n`);
    process.exit(1);
  }
  if (drift.length === 0) {
    console.log("Stripe matches the catalogue.\n");
    return;
  }
  if (apply) {
    console.log(`${drift.length} product(s) updated to match the catalogue.\n`);
    return;
  }
  console.log(`${drift.length} product(s) drifted. Re-run with --apply to correct them.\n`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
