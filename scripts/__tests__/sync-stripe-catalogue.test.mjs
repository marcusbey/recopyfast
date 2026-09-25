import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRICE_ENV,
  assertSafeCatalogueSource,
  createPrices,
  creationIdempotencyKey,
  creationSpecsFor,
  expectationsFor,
  priceLookupKey,
  validateCreationRow,
} from "../sync-stripe-catalogue.mjs";

const agency = {
  id: "agency",
  kind: "subscription",
  name: "Agency",
  description: "For agencies managing client websites",
  price_monthly: "49.00",
  price_yearly_monthly_equivalent: "40.83",
  price_yearly_total: "490.00",
};

const lifetimeAgency = {
  id: "lifetime_agency",
  kind: "one_time",
  name: "Founding Agency (lifetime)",
  description: "Founding lifetime access to Agency",
  price_monthly: "299.00",
  price_yearly_monthly_equivalent: null,
  price_yearly_total: null,
};

test("maps every Agency price to distinct test and live environment variables", () => {
  assert.deepEqual(PRICE_ENV.agency, {
    monthly: {
      test: "STRIPE_AGENCY_PRICE_ID",
      live: "STRIPE_AGENCY_PRICE_ID_LIVE",
    },
    yearly: {
      test: "STRIPE_AGENCY_YEARLY_PRICE_ID",
      live: "STRIPE_AGENCY_YEARLY_PRICE_ID_LIVE",
    },
  });
  assert.deepEqual(PRICE_ENV.lifetime_agency, {
    monthly: {
      test: "STRIPE_LIFETIME_AGENCY_PRICE_ID",
      live: "STRIPE_LIFETIME_AGENCY_PRICE_ID_LIVE",
    },
  });
});

test("keeps tooling price variable names aligned with the application resolver", async () => {
  const plansSource = await readFile(
    new URL("../../src/lib/stripe/plans.ts", import.meta.url),
    "utf8",
  );
  for (const periods of Object.values(PRICE_ENV)) {
    for (const pair of Object.values(periods)) {
      assert.match(plansSource, new RegExp(`\\b${pair.test}\\b`));
      assert.match(plansSource, new RegExp(`\\b${pair.live}\\b`));
    }
  }
});

test("uses the exact yearly total instead of multiplying the rounded equivalent", () => {
  assert.equal(expectationsFor(agency, "yearly").amount, 49_000);
});

test("creates Agency monthly, yearly, and founding one-time Stripe price payloads", () => {
  assert.deepEqual(creationSpecsFor(agency), [
    {
      period: "monthly",
      envName: "STRIPE_AGENCY_PRICE_ID",
      price: {
        currency: "usd",
        unit_amount: "4900",
        "recurring[interval]": "month",
        "recurring[interval_count]": "1",
      },
    },
    {
      period: "yearly",
      envName: "STRIPE_AGENCY_YEARLY_PRICE_ID",
      price: {
        currency: "usd",
        unit_amount: "49000",
        "recurring[interval]": "year",
        "recurring[interval_count]": "1",
      },
    },
  ]);

  assert.deepEqual(creationSpecsFor(lifetimeAgency), [
    {
      period: "monthly",
      envName: "STRIPE_LIFETIME_AGENCY_PRICE_ID",
      price: { currency: "usd", unit_amount: "29900" },
    },
  ]);
});

test("rejects Agency creation when the reviewed commercial terms drift", () => {
  assert.doesNotThrow(() => validateCreationRow(agency));
  assert.doesNotThrow(() =>
    validateCreationRow({ ...lifetimeAgency, grants_plan_id: "agency" }),
  );
  assert.throws(
    () => validateCreationRow({ ...agency, price_yearly_total: "489.96" }),
    /expected yearly amount \$490\.00/i,
  );
  assert.throws(
    () => validateCreationRow({ ...lifetimeAgency, grants_plan_id: "pro" }),
    /must grant "agency"/i,
  );
});

test("uses stable mode- and amount-specific idempotency keys for short creation retries", () => {
  assert.equal(
    creationIdempotencyKey("test", "agency", "yearly", "49000"),
    "recopyfast-test-agency-yearly-49000-price",
  );
  assert.notEqual(
    creationIdempotencyKey("test", "agency", "yearly", "49000"),
    creationIdempotencyKey("live", "agency", "yearly", "49000"),
  );
  assert.notEqual(
    creationIdempotencyKey("test", "agency", "yearly", "49000"),
    creationIdempotencyKey("test", "agency", "yearly", "49900"),
  );
});

function stripeProduct(id = "prod_agency") {
  return {
    id,
    name: "RecopyFast Agency",
    description: agency.description,
    metadata: { catalogue_id: "agency" },
  };
}

function stripePrice(period, product = "prod_agency", overrides = {}) {
  const expected = expectationsFor(agency, period);
  return {
    id: `price_agency_${period}`,
    active: true,
    livemode: false,
    unit_amount: expected.amount,
    currency: expected.currency,
    recurring: {
      interval: expected.recurringInterval,
      interval_count: 1,
    },
    product,
    lookup_key: priceLookupKey("test", "agency", period, expected.amount),
    metadata: {
      catalogue_id: "agency",
      catalogue_period: period,
      catalogue_mode: "test",
    },
    ...overrides,
  };
}

test("reuses persistent lookup-key prices after idempotency retention has expired", async () => {
  const calls = [];
  const requestStripe = async (_key, endpoint, form) => {
    calls.push({ endpoint, form });
    if (endpoint.startsWith("prices?lookup_keys")) {
      const period = endpoint.includes("yearly") ? "yearly" : "monthly";
      return { data: [stripePrice(period)], has_more: false };
    }
    if (endpoint === "products/prod_agency") return stripeProduct();
    throw new Error(`Unexpected Stripe request: ${endpoint}`);
  };

  await createPrices({
    secretKey: "sk_test_placeholder",
    row: agency,
    mode: "test",
    apply: true,
    requestStripe,
    log: () => {},
  });

  assert.equal(
    calls.some((call) => call.form),
    false,
  );
});

test("recovers legacy script output through paginated product metadata and price lists", async () => {
  const calls = [];
  const requestStripe = async (_key, endpoint, form) => {
    calls.push({ endpoint, form });
    if (endpoint.startsWith("prices?lookup_keys")) {
      return { data: [], has_more: false };
    }
    if (endpoint === "products?limit=100") {
      return {
        data: [
          {
            ...stripeProduct("prod_other"),
            metadata: { catalogue_id: "pro" },
          },
        ],
        has_more: true,
      };
    }
    if (endpoint === "products?limit=100&starting_after=prod_other") {
      return { data: [stripeProduct()], has_more: false };
    }
    if (endpoint === "prices?product=prod_agency&limit=100") {
      return { data: [stripePrice("monthly")], has_more: true };
    }
    if (
      endpoint ===
      "prices?product=prod_agency&limit=100&starting_after=price_agency_monthly"
    ) {
      return { data: [stripePrice("yearly")], has_more: false };
    }
    throw new Error(`Unexpected Stripe request: ${endpoint}`);
  };

  await createPrices({
    secretKey: "sk_test_placeholder",
    row: agency,
    mode: "test",
    apply: true,
    requestStripe,
    log: () => {},
  });

  assert.equal(
    calls.some((call) => call.form),
    false,
  );
  assert.equal(
    calls.some((call) => call.endpoint.includes("starting_after")),
    true,
  );
});

test("fails closed when a persistent lookup key points at a mismatched price", async () => {
  const calls = [];
  const requestStripe = async (_key, endpoint, form) => {
    calls.push({ endpoint, form });
    if (endpoint.startsWith("prices?lookup_keys")) {
      return {
        data: [stripePrice("monthly", "prod_agency", { unit_amount: 4_800 })],
        has_more: false,
      };
    }
    if (endpoint === "products/prod_agency") return stripeProduct();
    throw new Error(`Unexpected Stripe request: ${endpoint}`);
  };

  await assert.rejects(
    createPrices({
      secretKey: "sk_test_placeholder",
      row: agency,
      mode: "test",
      apply: true,
      requestStripe,
      log: () => {},
    }),
    /lookup key.*amount/i,
  );
  assert.equal(
    calls.some((call) => call.form),
    false,
  );
});

test("creates a metadata-stamped product and lookup-key prices when none exist", async () => {
  const calls = [];
  const requestStripe = async (_key, endpoint, form) => {
    calls.push({ endpoint, form });
    if (endpoint.startsWith("prices?lookup_keys")) {
      return { data: [], has_more: false };
    }
    if (endpoint === "products?limit=100") {
      return { data: [], has_more: false };
    }
    if (endpoint === "products" && form) return stripeProduct();
    if (endpoint === "prices" && form) {
      return { id: `price_${form.lookup_key}` };
    }
    throw new Error(`Unexpected Stripe request: ${endpoint}`);
  };

  await createPrices({
    secretKey: "sk_test_placeholder",
    row: agency,
    mode: "test",
    apply: true,
    requestStripe,
    log: () => {},
  });

  const writes = calls.filter((call) => call.form);
  assert.equal(writes.length, 3);
  assert.equal(writes[0].form["metadata[catalogue_id]"], "agency");
  assert.deepEqual(
    writes.slice(1).map((call) => call.form.lookup_key),
    [
      priceLookupKey("test", "agency", "monthly", 4_900),
      priceLookupKey("test", "agency", "yearly", 49_000),
    ],
  );
  assert.equal(writes[1].form["metadata[catalogue_id]"], "agency");
});

test("dry-run creation performs no Stripe reads or writes", async () => {
  let calls = 0;

  await createPrices({
    secretKey: "sk_test_placeholder",
    row: agency,
    mode: "test",
    apply: false,
    requestStripe: async () => {
      calls += 1;
      throw new Error("dry run must not call Stripe");
    },
    log: () => {},
  });

  assert.equal(calls, 0);
});

test("test mode accepts only loopback Supabase unless a local catalogue export is supplied", () => {
  assert.doesNotThrow(() =>
    assertSafeCatalogueSource("test", "http://127.0.0.1:54321", undefined),
  );
  assert.doesNotThrow(() =>
    assertSafeCatalogueSource(
      "test",
      "https://production.example.supabase.co",
      "catalogue.json",
    ),
  );
  assert.throws(
    () =>
      assertSafeCatalogueSource(
        "test",
        "https://production.example.supabase.co",
        undefined,
      ),
    /refusing a remote Supabase read/i,
  );
});
