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
 *   node scripts/sync-stripe-catalogue.mjs --mode=test --catalogue=plans.json --create=agency,lifetime_agency
 *   node scripts/sync-stripe-catalogue.mjs --mode=test --catalogue=plans.json --create=agency,lifetime_agency --apply
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
export const PRICE_ENV = {
  starter: {
    monthly: {
      test: "STRIPE_STARTER_PRICE_ID",
      live: "STRIPE_STARTER_PRICE_ID_LIVE",
    },
    yearly: {
      test: "STRIPE_STARTER_YEARLY_PRICE_ID",
      live: "STRIPE_STARTER_YEARLY_PRICE_ID_LIVE",
    },
  },
  pro: {
    monthly: { test: "STRIPE_PRO_PRICE_ID", live: "STRIPE_PRO_PRICE_ID_LIVE" },
    yearly: {
      test: "STRIPE_PRO_YEARLY_PRICE_ID",
      live: "STRIPE_PRO_YEARLY_PRICE_ID_LIVE",
    },
  },
  agency: {
    monthly: {
      test: "STRIPE_AGENCY_PRICE_ID",
      live: "STRIPE_AGENCY_PRICE_ID_LIVE",
    },
    yearly: {
      test: "STRIPE_AGENCY_YEARLY_PRICE_ID",
      live: "STRIPE_AGENCY_YEARLY_PRICE_ID_LIVE",
    },
  },
  credits: {
    monthly: {
      test: "STRIPE_TICKETS_PRICE_ID",
      live: "STRIPE_TICKETS_PRICE_ID_LIVE",
    },
  },
  lifetime_pro: {
    monthly: {
      test: "STRIPE_LIFETIME_PRICE_ID",
      live: "STRIPE_LIFETIME_PRICE_ID_LIVE",
    },
  },
  lifetime_agency: {
    monthly: {
      test: "STRIPE_LIFETIME_AGENCY_PRICE_ID",
      live: "STRIPE_LIFETIME_AGENCY_PRICE_ID_LIVE",
    },
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const mode = args
    .find((a) => a.startsWith("--mode="))
    ?.slice("--mode=".length);
  const apply = args.includes("--apply");
  const cataloguePath = args
    .find((a) => a.startsWith("--catalogue="))
    ?.slice("--catalogue=".length);
  const create = new Set(
    (
      args.find((a) => a.startsWith("--create="))?.slice("--create=".length) ??
      ""
    )
      .split(",")
      .filter(Boolean),
  );
  const only = new Set(
    (args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "")
      .split(",")
      .filter(Boolean),
  );

  if (mode !== "test" && mode !== "live") {
    console.error(
      "Refusing to guess which Stripe account to touch.\n" +
        "  node scripts/sync-stripe-catalogue.mjs --mode=test|live [--catalogue=FILE] [--only=PLAN,...] [--create=PLAN,...] [--apply]",
    );
    process.exit(2);
  }
  return { mode, apply, cataloguePath, create, only };
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

async function stripe(secretKey, endpoint, form, idempotencyKey) {
  const init = {
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
    },
  };
  if (form) {
    init.method = "POST";
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
    if (idempotencyKey) init.headers["Idempotency-Key"] = idempotencyKey;
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

export function assertSafeCatalogueSource(mode, url, cataloguePath) {
  if (mode !== "test" || cataloguePath) return;

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}`);
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(
      "Test mode is refusing a remote Supabase read. Start the local Supabase stack or pass " +
        "--catalogue=FILE with a reviewed local plans export.",
    );
  }
}

async function loadCatalogue(env, mode, cataloguePath) {
  if (cataloguePath) {
    const resolved = path.resolve(ROOT, cataloguePath);
    const parsed = JSON.parse(await readFile(resolved, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed?.plans;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`${cataloguePath} must contain a non-empty plans array.`);
    }
    return new Map(
      rows.filter((row) => row.is_active !== false).map((row) => [row.id, row]),
    );
  }

  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  assertSafeCatalogueSource(mode, url, cataloguePath);
  const key = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const response = await fetch(
    `${url}/rest/v1/plans?select=*&is_active=eq.true&order=sort_order`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to read plans: ${response.status} ${await response.text()}`,
    );
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
export function expectationsFor(row, period) {
  const name = `${BRAND} ${row.name}`;
  const description = row.description;

  if (period === "yearly") {
    const yearlyTotal =
      row.price_yearly_total ??
      Number(row.price_yearly_monthly_equivalent ?? row.price_monthly) * 12;
    return {
      name,
      description,
      amount: toCents(yearlyTotal),
      currency: "usd",
      recurringInterval: "year",
    };
  }
  return {
    name,
    description,
    amount: toCents(row.price_monthly),
    currency: "usd",
    recurringInterval: row.kind === "subscription" ? "month" : null,
  };
}

export function creationSpecsFor(row, mode = "test") {
  const periods = PRICE_ENV[row.id];
  if (!periods)
    throw new Error(
      `No Stripe price environment mapping exists for "${row.id}".`,
    );

  return Object.entries(periods).map(([period, envPair]) => {
    const expected = expectationsFor(row, period);
    const price = {
      currency: expected.currency,
      unit_amount: String(expected.amount),
    };
    if (expected.recurringInterval) {
      price["recurring[interval]"] = expected.recurringInterval;
      price["recurring[interval_count]"] = "1";
    }
    return { period, envName: envPair[mode], price };
  });
}

export function validateCreationRow(row) {
  // These values are a mutation fuse for the user-approved founding offer,
  // not a fallback catalogue. Every payload is still built from `plans`; this
  // guard stops a stale or mistyped export before it creates immutable Stripe
  // prices that cannot be corrected in place.
  const contract = {
    agency: { kind: "subscription", monthly: 4_900, yearly: 49_000 },
    lifetime_agency: {
      kind: "one_time",
      monthly: 29_900,
      grantsPlanId: "agency",
    },
  }[row.id];
  if (!contract) return;

  if (row.kind !== contract.kind) {
    throw new Error(
      `${row.id} must be a ${contract.kind} catalogue row before Stripe creation.`,
    );
  }
  const monthly = expectationsFor(row, "monthly").amount;
  if (monthly !== contract.monthly) {
    throw new Error(
      `${row.id} expected monthly amount $${(contract.monthly / 100).toFixed(2)}, received $${(monthly / 100).toFixed(2)}.`,
    );
  }
  if (
    "yearly" in contract &&
    expectationsFor(row, "yearly").amount !== contract.yearly
  ) {
    throw new Error(
      `${row.id} expected yearly amount $${(contract.yearly / 100).toFixed(2)} before Stripe creation.`,
    );
  }
  if (
    "grantsPlanId" in contract &&
    row.grants_plan_id !== contract.grantsPlanId
  ) {
    throw new Error(
      `${row.id} must grant "${contract.grantsPlanId}" before Stripe creation.`,
    );
  }
}

export function creationIdempotencyKey(mode, planId, period, amount) {
  // Stripe retains idempotency results for roughly 24 hours. This key closes
  // the short concurrent-retry race; price lookup keys and catalogue metadata
  // below are what prevent duplicates on a later operator rerun.
  return `recopyfast-${mode}-${planId}-${period}-${amount}-price`;
}

/** Persistent identity used after Stripe's 24-hour idempotency retention. */
export function priceLookupKey(mode, planId, period, amount) {
  return `recopyfast-${mode}-${planId}-${period}-${amount}`;
}

async function listAll(requestStripe, secretKey, endpoint) {
  const rows = [];
  let startingAfter = null;

  for (;;) {
    const page = await requestStripe(
      secretKey,
      `${endpoint}${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ""}`,
    );
    rows.push(...(page.data ?? []));
    if (!page.has_more) return rows;
    const last = rows.at(-1)?.id;
    if (!last) {
      throw new Error(`Stripe pagination for ${endpoint} had no cursor.`);
    }
    startingAfter = last;
  }
}

function productIdOf(price) {
  return typeof price.product === "string" ? price.product : price.product?.id;
}

function priceMismatch(price, expected, mode, productId) {
  const mismatches = [];
  if (price.livemode !== (mode === "live")) mismatches.push("mode");
  if (!price.active) mismatches.push("active state");
  if (price.unit_amount !== expected.amount) mismatches.push("amount");
  if (price.currency !== expected.currency) mismatches.push("currency");
  if ((price.recurring?.interval ?? null) !== expected.recurringInterval) {
    mismatches.push("recurring interval");
  }
  if (expected.recurringInterval && price.recurring?.interval_count !== 1) {
    mismatches.push("recurring interval count");
  }
  if (productIdOf(price) !== productId) mismatches.push("product identity");
  return mismatches;
}

async function readCatalogueProducts(requestStripe, secretKey, catalogueId) {
  const products = await listAll(
    requestStripe,
    secretKey,
    "products?limit=100",
  );
  return products.filter(
    (product) => product.metadata?.catalogue_id === catalogueId,
  );
}

/**
 * Creates or recovers Stripe prices without relying on idempotency retention.
 * `requestStripe` is injectable so tests prove the write boundary without any
 * account or network access.
 */
export async function createPrices({
  secretKey,
  row,
  mode,
  apply,
  requestStripe = stripe,
  log = console.log,
}) {
  validateCreationRow(row);
  const specs = creationSpecsFor(row, mode);
  log(`  ${apply ? "Creating or recovering" : "Would create"} ${row.id}:`);
  for (const spec of specs) {
    log(
      `    ${spec.period} $${(Number(spec.price.unit_amount) / 100).toFixed(2)} → ${spec.envName}`,
    );
  }
  if (!apply) return;

  const expected = expectationsFor(row, specs[0].period);
  const creationVersion = specs.map((spec) => spec.price.unit_amount).join("-");
  const recovered = new Map();
  let product = null;

  for (const spec of specs) {
    const periodExpected = expectationsFor(row, spec.period);
    const lookupKey = priceLookupKey(
      mode,
      row.id,
      spec.period,
      periodExpected.amount,
    );
    const candidates = await listAll(
      requestStripe,
      secretKey,
      `prices?lookup_keys%5B%5D=${encodeURIComponent(lookupKey)}&limit=100`,
    );
    if (candidates.length > 1) {
      throw new Error(
        `Stripe lookup key ${lookupKey} is ambiguous (${candidates.length} prices).`,
      );
    }
    if (candidates.length === 0) continue;

    const candidate = candidates[0];
    const candidateProductId = productIdOf(candidate);
    if (!candidateProductId) {
      throw new Error(
        `Stripe lookup key ${lookupKey} has no product identity.`,
      );
    }
    const candidateProduct = await requestStripe(
      secretKey,
      `products/${candidateProductId}`,
    );
    if (candidateProduct.metadata?.catalogue_id !== row.id) {
      throw new Error(
        `Stripe lookup key ${lookupKey} points at product ${candidateProductId}, which is not catalogue row ${row.id}.`,
      );
    }
    const mismatches = priceMismatch(
      candidate,
      periodExpected,
      mode,
      candidateProductId,
    );
    if (mismatches.length > 0) {
      throw new Error(
        `Stripe lookup key ${lookupKey} has mismatched ${mismatches.join(", ")}. Refusing to create a duplicate.`,
      );
    }
    if (product && product.id !== candidateProduct.id) {
      throw new Error(
        `${row.id} lookup keys point at different Stripe products (${product.id}, ${candidateProduct.id}).`,
      );
    }
    product = candidateProduct;
    recovered.set(spec.period, candidate);
  }

  if (!product) {
    const products = await readCatalogueProducts(
      requestStripe,
      secretKey,
      row.id,
    );
    if (products.length > 1) {
      throw new Error(
        `Stripe has ${products.length} products with catalogue_id=${row.id}; refusing an ambiguous recovery.`,
      );
    }
    product = products[0] ?? null;
  }

  if (product && recovered.size < specs.length) {
    const legacyPrices = await listAll(
      requestStripe,
      secretKey,
      `prices?product=${encodeURIComponent(product.id)}&limit=100`,
    );
    for (const spec of specs) {
      if (recovered.has(spec.period)) continue;
      const periodExpected = expectationsFor(row, spec.period);
      const matches = legacyPrices.filter(
        (candidate) =>
          priceMismatch(candidate, periodExpected, mode, product.id).length ===
          0,
      );
      if (matches.length > 1) {
        throw new Error(
          `${row.id} ${spec.period} has ${matches.length} matching legacy prices; refusing an ambiguous recovery.`,
        );
      }
      if (matches.length === 1) recovered.set(spec.period, matches[0]);
    }
  }

  if (!product) {
    product = await requestStripe(
      secretKey,
      "products",
      {
        name: expected.name,
        description: expected.description,
        "metadata[catalogue_id]": row.id,
      },
      `recopyfast-${mode}-${row.id}-${creationVersion}-product`,
    );
  }

  for (const spec of specs) {
    let price = recovered.get(spec.period);
    if (!price) {
      const periodExpected = expectationsFor(row, spec.period);
      const lookupKey = priceLookupKey(
        mode,
        row.id,
        spec.period,
        periodExpected.amount,
      );
      price = await requestStripe(
        secretKey,
        "prices",
        {
          ...spec.price,
          product: product.id,
          lookup_key: lookupKey,
          "metadata[catalogue_id]": row.id,
          "metadata[catalogue_period]": spec.period,
          "metadata[catalogue_mode]": mode,
        },
        creationIdempotencyKey(
          mode,
          row.id,
          spec.period,
          spec.price.unit_amount,
        ),
      );
    }
    log(`    ${spec.envName}=${price.id}`);
  }
}

async function main() {
  const { mode, apply, cataloguePath, create, only } = parseArgs();
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

  const catalogue = await loadCatalogue(env, mode, cataloguePath);
  console.log(
    `\n${mode.toUpperCase()} mode · ${apply ? "APPLYING changes" : "dry run (pass --apply to write)"}\n`,
  );

  // Several prices share a product (monthly and yearly), so the product is
  // updated once and the second pass sees it already correct.
  const seenProducts = new Set();
  const drift = [];
  const blockers = [];

  for (const planId of create) {
    const row = catalogue.get(planId);
    if (!row) {
      blockers.push(
        `plans has no active row for "${planId}", so its Stripe prices cannot be created.`,
      );
      continue;
    }
    if (!PRICE_ENV[planId]) {
      blockers.push(
        `No Stripe price environment mapping exists for "${planId}".`,
      );
      continue;
    }
    await createPrices({ secretKey, row, mode, apply });
  }

  const verificationEntries = Object.entries(PRICE_ENV).filter(
    ([planId]) => only.size === 0 || only.has(planId),
  );
  for (const planId of only) {
    if (!PRICE_ENV[planId])
      blockers.push(`No Stripe price mapping exists for "${planId}".`);
  }

  for (const [planId, periods] of create.size === 0
    ? verificationEntries
    : []) {
    const row = catalogue.get(planId);
    if (!row) {
      blockers.push(
        `plans has no active row for "${planId}", but a price is configured for it.`,
      );
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
        blockers.push(
          `${varName} points at a ${price.livemode ? "live" : "test"} price in ${mode} mode.`,
        );
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
      if (!price.active) {
        blockers.push(`${label}: Stripe price is inactive.`);
      }
      if (price.currency !== expected.currency) {
        blockers.push(
          `${label}: Stripe currency is ${price.currency}, expected ${expected.currency}.`,
        );
      }
      if ((price.recurring?.interval ?? null) !== expected.recurringInterval) {
        blockers.push(
          `${label}: Stripe recurrence is ${price.recurring?.interval ?? "one-time"}, expected ` +
            `${expected.recurringInterval ?? "one-time"}.`,
        );
      }
      if (expected.recurringInterval && price.recurring?.interval_count !== 1) {
        blockers.push(
          `${label}: Stripe recurrence interval count is ${price.recurring?.interval_count ?? "missing"}, expected 1.`,
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
        console.log(
          `      ${field}:\n        was: ${JSON.stringify(current ?? null)}\n        now: ${JSON.stringify(value)}`,
        );
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
    console.error(
      `\n${blockers.length} problem(s) need a human decision. Nothing above was auto-corrected.\n`,
    );
    process.exit(1);
  }
  if (create.size > 0) {
    console.log(
      apply
        ? "Stripe prices created. Install the printed ids, then run the check command.\n"
        : "Creation preview complete. Re-run with --apply to create these prices.\n",
    );
    return;
  }
  if (drift.length === 0) {
    console.log("Stripe matches the catalogue.\n");
    return;
  }
  if (apply) {
    console.log(`${drift.length} product(s) updated to match the catalogue.\n`);
    return;
  }
  console.log(
    `${drift.length} product(s) drifted. Re-run with --apply to correct them.\n`,
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}
