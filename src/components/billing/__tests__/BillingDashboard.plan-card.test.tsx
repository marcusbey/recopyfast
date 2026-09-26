import React from "react";
import { render, screen, within } from "@testing-library/react";
import { BillingDashboard } from "../BillingDashboard";
import type { LifetimeGrantStatus } from "../LifetimeOfferCard";
import type { BillingDashboardData, Subscription } from "@/types/billing";

/**
 * s45 review, finding 3: the billing page's plan card, as a lifetime Founding
 * Agency owner sees it.
 *
 * The card listed the catalogue Agency row's bullets verbatim, so an owner
 * whose allowance is 250 (ADR 038) read "1,000 AI credits / month" beside a
 * credit wallet saying 250 — and under a "$49/month" price for a plan they paid
 * for once. The allowance the card states must be the one the server resolved
 * (the wallet's `included`), and a plan held for life has no monthly price.
 */

jest.mock("../CheckoutStatusBanner", () => ({
  CheckoutStatusBanner: () => null,
}));

/** The Agency row as 20260924065000 seeds it. */
const AGENCY = {
  id: "agency",
  name: "Agency",
  description: "10 client websites, unlimited invited editors, Agency support",
  price: 49,
  yearlyPrice: 40.83,
  yearlyTotal: 490,
  features: [
    "10 client websites",
    "+$4 per additional website",
    "Unlimited invited editors",
    "Everything in Pro",
    "1,000 AI credits / month",
    "Priority support + onboarding call",
  ],
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
  description: "Up to 5 websites, all features, +$5 per additional website",
  price: 19,
  yearlyPrice: 15.77,
  yearlyTotal: undefined,
  features: ["Up to 5 websites", "AI A/B copy testing"],
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

function wallet(included: number) {
  return {
    balance: included,
    included,
    purchased: 0,
    usedThisMonth: 0,
    totalPurchased: 0,
    totalConsumed: 0,
  };
}

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
    recentTransactions: [],
    currentUsage: {
      websites: 0,
      collaborators: 0,
      aiUsage: 0,
      translations: 0,
    },
    catalogue: CATALOGUE,
    effectivePlanId: "agency",
    trial: null,
    everTrialed: false,
    ...overrides,
  } as BillingDashboardData;
}

async function renderPlanCard(
  data: BillingDashboardData,
  lifetimeGrant: LifetimeGrantStatus,
) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => data,
  });
  render(
    <BillingDashboard
      lifetimeGrant={lifetimeGrant}
      foundingAgencyAvailability={null}
    />,
  );
  const features = await screen.findByRole("heading", {
    name: /plan features/i,
  });
  return {
    features: within(features.parentElement as HTMLElement),
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the plan card for a lifetime Founding Agency owner", () => {
  it("states the 250 the owner gets, never Agency's 1,000", async () => {
    const { features } = await renderPlanCard(
      payload({ creditWallet: wallet(250) }),
      { kind: "granted", planIds: ["agency"] },
    );

    expect(features.getByText("250 AI credits / month")).toBeInTheDocument();
    expect(features.queryByText(/1,000 AI credits/)).toBeNull();
    // Every other Agency bullet is still theirs.
    expect(features.getByText("Unlimited invited editors")).toBeInTheDocument();
    expect(features.getAllByRole("listitem")).toHaveLength(6);
  });

  it("shows no monthly price for a plan paid for once", async () => {
    await renderPlanCard(payload({ creditWallet: wallet(250) }), {
      kind: "granted",
      planIds: ["agency"],
    });

    expect(screen.queryByText(/\$49\/month/)).toBeNull();
    expect(screen.getByText("Lifetime access")).toBeInTheDocument();
  });

  it("states the allowance the server resolved when another plan lifts it", async () => {
    // A Lifetime Pro owner who bought Founding Agency keeps Pro's 500 (the
    // resolver's floor); the card follows the wallet, not the lifetime's copy.
    const { features } = await renderPlanCard(
      payload({ creditWallet: wallet(500) }),
      { kind: "granted", planIds: ["pro", "agency"] },
    );

    expect(features.getByText("500 AI credits / month")).toBeInTheDocument();
    expect(features.queryByText(/250 AI credits|1,000 AI credits/)).toBeNull();
  });

  it("keeps a lifetime price while a lower subscription runs out its period", async () => {
    await renderPlanCard(
      payload({ creditWallet: wallet(500), subscription: subscription("pro") }),
      { kind: "granted", planIds: ["agency"] },
    );

    expect(screen.queryByText(/\$49\/month/)).toBeNull();
    expect(screen.getByText("Lifetime access")).toBeInTheDocument();
  });

  it("does not restate an allowance it was not given", async () => {
    const { features } = await renderPlanCard(
      payload({ creditWallet: undefined }),
      { kind: "granted", planIds: ["agency"] },
    );

    expect(features.queryByText(/AI credits/)).toBeNull();
    expect(features.getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("the plan card for a plan that is not held for life", () => {
  it("is not called lifetime because some other plan was granted", async () => {
    // A Pro trial is the plan in force; the permanent grant is a Starter comp.
    await renderPlanCard(
      payload({ effectivePlanId: "pro", creditWallet: wallet(500) }),
      { kind: "granted", planIds: ["starter"] },
    );

    expect(screen.queryByText("Lifetime access")).toBeNull();
  });
});

describe("the plan card for an Agency subscriber", () => {
  it("shows Agency's 1,000 and the $49 monthly price", async () => {
    const { features } = await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        subscription: subscription("agency"),
      }),
      { kind: "none" },
    );

    expect(features.getByText("1,000 AI credits / month")).toBeInTheDocument();
    expect(screen.getByText("$49/month")).toBeInTheDocument();
    expect(screen.queryByText("Lifetime access")).toBeNull();
  });
});
