/**
 * s82 — a lifetime owner cannot restart, or switch into, billing for a plan
 * the grant covers.
 *
 * Buying Lifetime Pro or Founding Agency sets every live subscription the grant
 * replaces to cancel at period end (the Stripe webhook's
 * `stopBillingForLifetimeOwner`). The billing card stopped offering
 * "Reactivate" there in s71, but `POST /api/billing/subscription/reactivate`
 * never asked: one request restarted monthly billing for a plan the customer
 * already owns (s71 review, server-side gap). The plan change
 * (`PUT /api/billing/subscription`) had the same gap, and so did Checkout's
 * subscription intent (s82 review, finding 1 — its cases are in
 * `src/__tests__/api/billing/checkout-lifetime-covered.test.ts`).
 *
 * The real `reactivateSubscription`, `updateSubscription` and
 * `readGrantedPlanIds` run here against a fake client that applies the query's
 * own filters to seeded rows, so "trial rows do not count", "revoked grants do
 * not count" and "expired grants do not count" are proved by the same `.neq` /
 * `.is` / `.or` the production query sends — not by a mock that already
 * returns the right answer. Stripe is a mock; nothing is called for real.
 */

interface SubscriptionRow {
  id: string;
  user_id: string;
  customer_id: string;
  stripe_subscription_id: string;
  plan: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

interface GrantRow {
  user_id: string;
  plan_id: string;
  source: string;
  revoked_at: string | null;
  expires_at: string | null;
  stripe_payment_intent_id: string | null;
}

const USER_ID = "user-1";
const STRIPE_SUBSCRIPTION_ID = "sub_stripe_1";

function subscriptionRow(plan: string): SubscriptionRow {
  return {
    id: "row-1",
    user_id: USER_ID,
    customer_id: "cus_row_1",
    stripe_subscription_id: STRIPE_SUBSCRIPTION_ID,
    plan,
    status: "active",
    current_period_start: "2026-09-10T00:00:00.000Z",
    current_period_end: "2026-10-10T00:00:00.000Z",
    // Set to cancel at period end — what the webhook leaves after a lifetime
    // purchase, and the only state reactivation acts on.
    cancel_at: "2026-10-10T00:00:00.000Z",
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
  };
}

function purchasedGrant(planId: string): GrantRow {
  return {
    user_id: USER_ID,
    plan_id: planId,
    source: "lifetime_purchase",
    revoked_at: null,
    expires_at: null,
    stripe_payment_intent_id: `pi_${planId}`,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A non-trial grant with a date on it — production holds one (source
 * `qa_recovery_20260919`, s82 review finding 2). `days` ahead, or behind when
 * negative.
 */
function datedGrant(planId: string, days: number): GrantRow {
  return {
    ...purchasedGrant(planId),
    source: "qa_recovery_20260919",
    stripe_payment_intent_id: null,
    expires_at: new Date(Date.now() + days * DAY_MS).toISOString(),
  };
}

/** One arm of a PostgREST `.or()` expression, e.g. `expires_at.gt.<iso>`. */
function armPredicate(arm: string): (row: GrantRow) => boolean {
  const [column, operator, ...rest] = arm.split(".");
  const value = rest.join(".");
  const read = (row: GrantRow) =>
    (row as unknown as Record<string, unknown>)[column] ?? null;
  if (operator === "is" && value === "null") {
    return (row) => read(row) === null;
  }
  if (operator === "gt") {
    return (row) => String(read(row) ?? "") > value;
  }
  throw new Error(`Unsupported or() arm in test stub: ${arm}`);
}

let stored: SubscriptionRow = subscriptionRow("pro");
let grants: GrantRow[] = [];
let grantReadFails = false;

/** A `plan_entitlements` read that applies `eq` / `is` / `neq` / `or` like PostgREST. */
function grantQuery() {
  const filters: Array<(row: GrantRow) => boolean> = [];
  const query = {
    select: () => query,
    eq: (column: keyof GrantRow, value: unknown) => {
      filters.push((row) => row[column] === value);
      return query;
    },
    is: (column: keyof GrantRow, value: null) => {
      filters.push((row) => row[column] === value);
      return query;
    },
    neq: (column: keyof GrantRow, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return query;
    },
    or: (expression: string) => {
      const arms = expression.split(",").map(armPredicate);
      filters.push((row) => arms.some((arm) => arm(row)));
      return query;
    },
    returns: () => query,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        grantReadFails
          ? { data: null, error: { message: "connection reset" } }
          : {
              data: grants
                .filter((row) => filters.every((keep) => keep(row)))
                .map((row) => ({ plan_id: row.plan_id })),
              error: null,
            },
      ).then(resolve),
  };
  return query;
}

/** The newest `billing_subscriptions` row, read or written. */
function subscriptionQuery() {
  let patch: Partial<SubscriptionRow> | null = null;
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    update: (values: Partial<SubscriptionRow>) => {
      patch = values;
      return query;
    },
    single: async () => {
      if (patch) stored = { ...stored, ...patch };
      return { data: { ...stored }, error: null };
    },
  };
  return query;
}

function fakeClient() {
  return {
    from: (table: string) =>
      table === "plan_entitlements" ? grantQuery() : subscriptionQuery(),
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => fakeClient()),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => fakeClient()),
}));

const mockStripeRetrieve = jest.fn();
const mockStripeUpdate = jest.fn();

jest.mock("@/lib/stripe/config", () => ({
  stripe: {
    subscriptions: {
      retrieve: (...args: unknown[]) => mockStripeRetrieve(...args),
      update: (...args: unknown[]) => mockStripeUpdate(...args),
    },
  },
}));

jest.mock("@/lib/stripe/plans", () => ({
  getPaidPlan: jest.fn(async (planId: string) => ({ id: planId })),
  resolveStripePriceId: jest.fn(
    async (planId: string, period: string) => `price_${planId}_${period}`,
  ),
  findPlanById: jest.fn(async () => null),
  findPurchasedPlanById: jest.fn(async () => null),
}));

import {
  reactivateSubscription,
  updateSubscription,
} from "@/lib/stripe/subscription";
import { BillingRefusal } from "@/lib/billing/billing-refusal";
import { isPlanCoveredByGrants } from "@/lib/stripe/plan-types";

const LIFETIME_REFUSAL =
  "Your lifetime plan already includes this one, so this subscription can't be restarted.";

const LIFETIME_PLAN_CHANGE_REFUSAL =
  "Your lifetime plan already includes this one. Cancel your subscription instead of switching to it.";

beforeEach(() => {
  jest.clearAllMocks();
  stored = subscriptionRow("pro");
  grants = [];
  grantReadFails = false;
  mockStripeUpdate.mockResolvedValue({ id: STRIPE_SUBSCRIPTION_ID });
  // The plan change reads the live item's price, then swaps it.
  mockStripeRetrieve.mockImplementation(async () => ({
    id: STRIPE_SUBSCRIPTION_ID,
    metadata: { user_id: USER_ID },
    items: {
      data: [{ id: "si_1", price: { id: `price_${stored.plan}_monthly` } }],
    },
  }));
});

async function expectRefused() {
  const error = await reactivateSubscription(USER_ID).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BillingRefusal);
  expect((error as BillingRefusal).status).toBe(409);
  expect((error as BillingRefusal).message).toBe(LIFETIME_REFUSAL);
  // Refused before Stripe: nothing restarted, nothing written.
  expect(mockStripeUpdate).not.toHaveBeenCalled();
  expect(stored.cancel_at).toBe("2026-10-10T00:00:00.000Z");
}

async function expectReactivated() {
  await expect(reactivateSubscription(USER_ID)).resolves.toMatchObject({
    cancel_at_period_end: false,
  });
  expect(mockStripeUpdate).toHaveBeenCalledWith(STRIPE_SUBSCRIPTION_ID, {
    cancel_at_period_end: false,
  });
  expect(stored.cancel_at).toBeNull();
}

describe("reactivating a subscription a lifetime grant covers", () => {
  it("is refused for a Lifetime Pro owner's Pro subscription", async () => {
    stored = subscriptionRow("pro");
    grants = [purchasedGrant("pro")];

    await expectRefused();
  });

  // CTO decision (docs/plans/s82-billing-lifetime-guards.md, decision 1): the
  // Agency subscription lifts a Founding Agency owner to 1,000 credits while it
  // runs (ADR 038), but the product never sells that pairing — the webhook
  // cancels it when the lifetime lands, and Checkout and the plan change refuse
  // to start it (s82 review, finding 1). Restarting it here would bill $49 a
  // month for a plan already owned.
  it("is refused for a Founding Agency owner's Agency subscription", async () => {
    stored = subscriptionRow("agency");
    grants = [purchasedGrant("agency")];

    await expectRefused();
  });

  it("is refused for a lower subscription under an Agency grant", async () => {
    stored = subscriptionRow("pro");
    grants = [purchasedGrant("agency")];

    await expectRefused();
  });

  it("is refused under a comped grant too: it is held for life all the same", async () => {
    stored = subscriptionRow("starter");
    grants = [
      {
        ...purchasedGrant("pro"),
        source: "support",
        stripe_payment_intent_id: null,
      },
    ];

    await expectRefused();
  });
});

describe("reactivating a subscription no lifetime grant covers (unchanged)", () => {
  // The webhook keeps a running Agency subscription beside a Lifetime Pro
  // grant (route.ts: `grantsPlanId === "pro" && subscription.plan === "agency"`);
  // the owner may restart it like any subscriber.
  it("reactivates an Agency subscription above a Lifetime Pro grant", async () => {
    stored = subscriptionRow("agency");
    grants = [purchasedGrant("pro")];

    await expectReactivated();
  });

  it("reactivates when the only Pro row is a trial", async () => {
    stored = subscriptionRow("pro");
    grants = [
      {
        ...purchasedGrant("pro"),
        source: "trial",
        stripe_payment_intent_id: null,
      },
    ];

    await expectReactivated();
  });

  it("reactivates when the lifetime grant was revoked", async () => {
    stored = subscriptionRow("pro");
    grants = [
      { ...purchasedGrant("pro"), revoked_at: "2026-09-20T00:00:00.000Z" },
    ];

    await expectReactivated();
  });

  it("reactivates when the only grant belongs to another account", async () => {
    stored = subscriptionRow("pro");
    grants = [{ ...purchasedGrant("agency"), user_id: "someone-else" }];

    await expectReactivated();
  });

  it("reactivates a plain subscriber with no grant", async () => {
    stored = subscriptionRow("pro");
    grants = [];

    await expectReactivated();
  });

  it("fails closed, before Stripe, when the grants cannot be read", async () => {
    stored = subscriptionRow("pro");
    grantReadFails = true;

    const error = await reactivateSubscription(USER_ID).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BillingRefusal);
    expect(mockStripeUpdate).not.toHaveBeenCalled();
  });
});

/**
 * s82 review, finding 2: a non-trial grant with a date is held until that
 * date and not after — the rule the entitlement resolver already applies.
 */
describe("reactivating under a dated non-trial grant", () => {
  it("reactivates once the grant has expired", async () => {
    stored = subscriptionRow("pro");
    grants = [datedGrant("pro", -1)];

    await expectReactivated();
  });

  it("is refused while the grant has not expired", async () => {
    stored = subscriptionRow("pro");
    grants = [datedGrant("pro", 30)];

    await expectRefused();
  });
});

/**
 * s82 review, finding 1: `PUT /api/billing/subscription` (the plan dialog's
 * "Switch to …") never read grants. A Lifetime Pro owner still paying for
 * Agency could switch the subscription to Pro or Starter and keep paying every
 * month for a plan the grant already includes. Same rank rule as reactivation
 * and the webhook: a subscription above every grant is a plan the account
 * does not hold, and stays on sale.
 */
describe("changing a subscription to a plan a lifetime grant covers", () => {
  async function expectChangeRefused(planId: "starter" | "pro" | "agency") {
    const before = { ...stored };
    const error = await updateSubscription(USER_ID, { planId }).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(BillingRefusal);
    expect((error as BillingRefusal).status).toBe(409);
    expect((error as BillingRefusal).message).toBe(
      LIFETIME_PLAN_CHANGE_REFUSAL,
    );
    // Refused before Stripe: nothing read there, nothing prorated or written.
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(stored).toEqual(before);
  }

  it("refuses Pro to a Lifetime Pro owner paying for Agency", async () => {
    stored = subscriptionRow("agency");
    grants = [purchasedGrant("pro")];

    await expectChangeRefused("pro");
  });

  it("refuses Starter to a Lifetime Pro owner paying for Agency", async () => {
    stored = subscriptionRow("agency");
    grants = [purchasedGrant("pro")];

    await expectChangeRefused("starter");
  });

  it("refuses Pro to a Founding Agency owner running out an Agency subscription", async () => {
    stored = subscriptionRow("agency");
    grants = [purchasedGrant("agency")];

    await expectChangeRefused("pro");
  });

  it("is refused while a dated grant has not expired", async () => {
    stored = subscriptionRow("starter");
    grants = [datedGrant("pro", 30)];

    await expectChangeRefused("pro");
  });

  it("fails closed, before Stripe, when the grants cannot be read", async () => {
    stored = subscriptionRow("starter");
    grantReadFails = true;

    const error = await updateSubscription(USER_ID, { planId: "pro" }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BillingRefusal);
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(mockStripeUpdate).not.toHaveBeenCalled();
  });
});

describe("changing a subscription to a plan no lifetime grant covers (unchanged)", () => {
  async function expectChanged(planId: "starter" | "pro" | "agency") {
    mockStripeUpdate.mockResolvedValue({
      id: STRIPE_SUBSCRIPTION_ID,
      status: "active",
      cancel_at: null,
      latest_invoice: { status: "paid", hosted_invoice_url: null },
      items: {
        data: [
          {
            id: "si_1",
            price: { id: `price_${planId}_monthly` },
            current_period_start: 1788163200,
            current_period_end: 1790755200,
          },
        ],
      },
    });

    await expect(
      updateSubscription(USER_ID, { planId }),
    ).resolves.toMatchObject({ subscription: { plan_id: planId } });
    expect(mockStripeUpdate).toHaveBeenCalledWith(
      STRIPE_SUBSCRIPTION_ID,
      expect.objectContaining({
        items: [{ id: "si_1", price: `price_${planId}_monthly` }],
        proration_behavior: "always_invoice",
      }),
    );
    expect(stored.plan).toBe(planId);
  }

  it("switches a Lifetime Pro owner's Pro subscription up to Agency", async () => {
    stored = subscriptionRow("pro");
    grants = [purchasedGrant("pro")];

    await expectChanged("agency");
  });

  it("switches when the only Pro row is a trial", async () => {
    stored = subscriptionRow("starter");
    grants = [
      {
        ...purchasedGrant("pro"),
        source: "trial",
        stripe_payment_intent_id: null,
      },
    ];

    await expectChanged("pro");
  });

  it("switches once a dated grant has expired", async () => {
    stored = subscriptionRow("starter");
    grants = [datedGrant("pro", -1)];

    await expectChanged("pro");
  });

  it("switches a plain subscriber with no grant", async () => {
    stored = subscriptionRow("starter");

    await expectChanged("pro");
  });
});

describe("isPlanCoveredByGrants", () => {
  it.each([
    ["pro", ["pro"], true],
    ["pro", ["agency"], true],
    ["starter", ["pro"], true],
    ["agency", ["agency"], true],
    ["agency", ["pro"], false],
    ["pro", ["starter"], false],
    ["pro", [], false],
    // Retired and unknown ids rank nowhere: they cover nothing and are
    // covered by nothing, which leaves such a subscription as it was.
    ["pro", ["free"], false],
    ["free", ["agency"], false],
    ["enterprise", ["agency"], false],
  ] as const)("%s under %j → %s", (planId, granted, expected) => {
    expect(isPlanCoveredByGrants(planId, granted)).toBe(expected);
  });
});
