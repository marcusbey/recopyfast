import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRICE_ENV,
  assertSafeCatalogueSource,
  creationIdempotencyKey,
  creationSpecsFor,
  expectationsFor,
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

test("uses stable mode- and amount-specific idempotency keys for creation retries", () => {
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
