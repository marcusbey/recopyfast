import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillingDashboard } from "../BillingDashboard";
import type { BillingDashboardData, Subscription } from "@/types/billing";

/**
 * PR #49 review, finding 1 (critical): a trial or founding offer account could
 * not subscribe from the billing page.
 *
 * The dialog read "has a subscription" off the plan in force. A trialling or
 * offer account resolves to `pro` with no Stripe subscription at all, so the
 * dialog marked Pro as its current plan (nothing to buy) and sent every other
 * plan to `PUT /api/billing/subscription`, which answers "No active
 * subscription found". Converting — the whole point of a trial — failed.
 *
 * Asserted on the wire: what the page asks the server to do, per account.
 */

jest.mock("../CheckoutStatusBanner", () => ({
  CheckoutStatusBanner: () => null,
}));

const AGENCY = {
  id: "agency",
  name: "Agency",
  description: "10 client websites",
  price: 49,
  yearlyPrice: 40.83,
  yearlyTotal: 490,
  features: [],
  limits: {
    websites: 10,
    collaborators: -1,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 1000,
  },
  additionalSitePrice: 4,
  sortOrder: 25,
};

const PRO = {
  ...AGENCY,
  id: "pro",
  name: "Pro",
  description: "Up to 5 websites",
  price: 19,
  yearlyPrice: 15.77,
  yearlyTotal: undefined,
  limits: {
    ...AGENCY.limits,
    websites: 5,
    collaborators: 5,
    monthlyCredits: 500,
  },
  additionalSitePrice: 5,
  sortOrder: 20,
};

const CATALOGUE = {
  subscriptions: [PRO, AGENCY],
  oneTimeProducts: [],
  creditPack: {
    creditsPerPack: 1000,
    maxPacksPerPurchase: 100,
    pricePerPack: 19,
  },
};

const EMPTY_WALLET = {
  balance: 0,
  included: 0,
  purchased: 0,
  usedThisMonth: 0,
  totalPurchased: 0,
  totalConsumed: 0,
};

const OFFER_TRIAL = {
  daysRemaining: 64,
  endsAt: "2026-12-26T15:00:00.000Z",
  creditsUsed: 12,
  creditsLimit: 100,
  offerId: "founding_20" as const,
};

const PLAIN_TRIAL = {
  daysRemaining: 9,
  endsAt: "2026-10-07T15:00:00.000Z",
  creditsUsed: 120,
  creditsLimit: 500,
};

function subscription(plan: string): Subscription {
  return {
    id: "sub-row-1",
    user_id: "user-1",
    customer_id: "cus-row-1",
    stripe_subscription_id: "sub_1",
    plan_id: plan,
    status: "active",
    current_period_start: "2026-09-10T00:00:00.000Z",
    current_period_end: "2026-10-10T00:00:00.000Z",
    cancel_at_period_end: false,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
  };
}

function payload(
  overrides: Partial<BillingDashboardData>,
): BillingDashboardData {
  return {
    paymentMethods: [],
    invoices: [],
    creditWallet: EMPTY_WALLET,
    recentTransactions: [],
    currentUsage: {
      websites: 0,
      collaborators: 0,
      aiUsage: 0,
      translations: 0,
    },
    catalogue: CATALOGUE,
    effectivePlanId: "pro",
    trial: null,
    everTrialed: false,
    ...overrides,
  } as BillingDashboardData;
}

/** Every request the page makes, and a server that answers each by path. */
function serve(data: BillingDashboardData) {
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url === "/api/billing/dashboard") {
      return { ok: true, json: async () => data };
    }
    // Checkout and plan change both stop here: what matters is which one the
    // page asked for, and with what.
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: "stopped by the test" }),
      headers: new Headers(),
    };
  });
  render(
    <BillingDashboard
      lifetimeGrant={{ kind: "none" }}
      foundingAgencyAvailability={null}
    />,
  );
}

function callsTo(path: string) {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === path);
}

async function openPlans(
  user: ReturnType<typeof userEvent.setup>,
  button: string,
) {
  await user.click(await screen.findByRole("button", { name: button }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an account with no subscription subscribes through Checkout", () => {
  it.each([
    [
      "a founding offer account, from the offer card",
      OFFER_TRIAL,
      "Choose a plan",
    ],
    ["a founding offer account, from the header", OFFER_TRIAL, "Change plan"],
    ["a 14-day trial account, from the header", PLAIN_TRIAL, "Change plan"],
  ])("%s: Pro", async (_label, trial, entry) => {
    const user = userEvent.setup();
    serve(payload({ trial }));

    const dialog = await openPlans(user, entry);
    expect(
      within(dialog).getByRole("heading", { name: "Choose your plan" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /^Pro/ }));
    await user.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );

    await waitFor(() =>
      expect(callsTo("/api/billing/checkout")).toHaveLength(1),
    );
    expect(JSON.parse(callsTo("/api/billing/checkout")[0][1].body)).toEqual({
      intent: "subscription",
      planId: "pro",
      billingPeriod: "monthly",
    });
    expect(callsTo("/api/billing/subscription")).toHaveLength(0);
  });

  it.each([
    ["a founding offer account", OFFER_TRIAL, "Choose a plan"],
    ["a 14-day trial account", PLAIN_TRIAL, "Change plan"],
  ])("%s: Agency", async (_label, trial, entry) => {
    const user = userEvent.setup();
    serve(payload({ trial }));

    const dialog = await openPlans(user, entry);
    await user.click(within(dialog).getByRole("radio", { name: /^Agency/ }));
    await user.click(
      within(dialog).getByRole("button", { name: /continue to payment/i }),
    );

    await waitFor(() =>
      expect(callsTo("/api/billing/checkout")).toHaveLength(1),
    );
    expect(
      JSON.parse(callsTo("/api/billing/checkout")[0][1].body),
    ).toMatchObject({
      intent: "subscription",
      planId: "agency",
    });
    expect(callsTo("/api/billing/subscription")).toHaveLength(0);
  });

  it("does not present a trial's plan as one the account already has", async () => {
    const user = userEvent.setup();
    serve(payload({ trial: PLAIN_TRIAL }));

    const dialog = await openPlans(user, "Change plan");

    expect(within(dialog).queryByText("Current")).toBeNull();
  });
});

describe("a subscriber changes plan in place", () => {
  it("sends the new plan to the subscription, not to Checkout", async () => {
    const user = userEvent.setup();
    serve(payload({ subscription: subscription("pro") }));

    const dialog = await openPlans(user, "Change plan");
    expect(
      within(dialog).getByRole("heading", { name: "Change your plan" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: /^Agency/ }));
    await user.click(
      within(dialog).getByRole("button", { name: /switch to agency/i }),
    );

    await waitFor(() =>
      expect(callsTo("/api/billing/subscription")).toHaveLength(1),
    );
    const [, init] = callsTo("/api/billing/subscription")[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      planId: "agency",
      billingPeriod: "monthly",
    });
    expect(callsTo("/api/billing/checkout")).toHaveLength(0);
  });

  it("still marks the subscribed plan as current, with nothing to buy", async () => {
    const user = userEvent.setup();
    serve(payload({ subscription: subscription("pro") }));

    const dialog = await openPlans(user, "Change plan");
    await user.click(within(dialog).getByRole("radio", { name: /^Pro/ }));

    expect(within(dialog).getByText("Current")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /switch to pro/i }),
    ).toBeDisabled();
  });
});

/**
 * s82, Devin Review on PR #81 (finding 2): the plan change now clears a
 * scheduled cancellation — buying another plan means keeping it — so the
 * dialog has to say so before the click, or a subscriber who had set theirs to
 * end is surprised by a renewal.
 */
describe("a subscriber whose subscription is set to end changes plan", () => {
  const unchanged =
    "Switch plans at any time. Stripe prorates the difference and charges your card on file straight away.";

  it("is told the change keeps the subscription, which will renew", async () => {
    const user = userEvent.setup();
    serve(
      payload({
        subscription: {
          ...subscription("pro"),
          cancel_at_period_end: true,
          // Midday, so the date reads October 10 in any test timezone.
          current_period_end: "2026-10-10T12:00:00.000Z",
        },
      }),
    );

    const dialog = await openPlans(user, "Change plan");

    expect(dialog).toHaveTextContent(
      "Your subscription is set to end on October 10, 2026. Switching plans keeps it: it will renew instead of ending.",
    );
  });

  it("reads the description unchanged for a subscription that renews", async () => {
    const user = userEvent.setup();
    serve(payload({ subscription: subscription("pro") }));

    const dialog = await openPlans(user, "Change plan");

    expect(within(dialog).getByText(unchanged)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/set to end/);
  });
});
