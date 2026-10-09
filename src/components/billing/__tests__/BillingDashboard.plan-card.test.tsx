import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

function subscription(
  plan: string,
  overrides: Partial<Subscription> = {},
): Subscription {
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
    ...overrides,
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

  // s82 (s71 review N-1): the server resolves what the allowance becomes once
  // the Agency subscription the owner is running out ends; the page passes it
  // to the card's running-out row.
  it("says the 250 that follows the Agency subscription it runs out", async () => {
    await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        includedAfterSubscription: 250,
        subscription: subscription("agency", {
          cancel_at_period_end: true,
          // Midday, so the date reads October 10 in any test timezone.
          current_period_end: "2026-10-10T12:00:00.000Z",
        }),
      }),
      { kind: "granted", planIds: ["agency"] },
    );

    expect(
      screen.getByText(
        "Your Agency subscription ends October 10, 2026 — you won't be charged again. Without it, your plan includes 250 AI credits a month.",
      ),
    ).toBeInTheDocument();
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

describe("the plan dialog for a lifetime Founding Agency owner", () => {
  // s82 (s45 review #1): "Change plan" marked Agency "Current" at $49/month
  // with 1,000 credits. The page now tells the dialog which plan is held for
  // life and with what allowance; the dialog's own test proves the tile.
  it("shows Agency as Lifetime access with the owner's 250, no price", async () => {
    await renderPlanCard(payload({ creditWallet: wallet(250) }), {
      kind: "granted",
      planIds: ["agency"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    const dialog = await screen.findByRole("dialog");
    const tile = within(dialog).getByRole("radio", { name: /^Agency/ });

    expect(tile).toHaveTextContent("Lifetime access");
    expect(tile).toHaveTextContent("250 AI credits / month");
    expect(tile).not.toHaveTextContent("$49");
    expect(tile).not.toHaveTextContent("Current");
  });

  it("keeps Current and $49 for an Agency subscriber", async () => {
    await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        subscription: subscription("agency"),
      }),
      { kind: "none" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    const dialog = await screen.findByRole("dialog");
    const tile = within(dialog).getByRole("radio", { name: /^Agency/ });

    expect(tile).toHaveTextContent("Current");
    expect(tile).toHaveTextContent("$49");
  });
});

describe("the plan dialog for a Lifetime Pro owner paying for Agency", () => {
  // s82 review, finding 1: the page passes the account's grants to the
  // dialog, so a plan a grant includes (Pro, under Lifetime Pro) is refused
  // there as the server refuses it — even though Agency, not Pro, is the plan
  // in force and nothing is "held for life" on the card.
  it("refuses Pro, which Lifetime Pro already includes", async () => {
    await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        subscription: subscription("agency"),
      }),
      { kind: "granted", planIds: ["pro"] },
    );

    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    const dialog = await screen.findByRole("dialog");
    const pro = within(dialog).getByRole("radio", { name: /^Pro/ });
    fireEvent.click(pro);

    expect(pro).toHaveTextContent("Included");
    expect(
      within(dialog).getByRole("button", {
        name: "Included in your lifetime Pro",
      }),
    ).toBeDisabled();
  });

  // s82 review (second pass), m3: the page's grant read also says when a
  // dated grant ends, and the dialog receives it — a grant that ends is never
  // called lifetime.
  it("says until when, not for life, when the Pro grant is dated", async () => {
    await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        subscription: subscription("agency"),
      }),
      {
        kind: "granted",
        planIds: ["pro"],
        endsAt: { pro: "2026-11-19T12:00:00.000Z" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    const dialog = await screen.findByRole("dialog");
    const pro = within(dialog).getByRole("radio", { name: /^Pro/ });
    fireEvent.click(pro);

    expect(pro).toHaveTextContent("Included until November 19, 2026");
    expect(pro).not.toHaveTextContent("for life");
    expect(
      within(dialog).getByRole("button", {
        name: "Included in your plan until November 19, 2026",
      }),
    ).toBeDisabled();
  });
});

describe("the plan card for a Pro subscriber who bought Lifetime Pro", () => {
  // s71 review M-1: the plan held for life used to count only when no
  // subscription billed that very plan. But buying Lifetime Pro sets the Pro
  // subscription to cancel at period end (the Stripe webhook's
  // stopBillingForLifetimeOwner) — so for up to a month the card read
  // "$19/month · ACTIVE" for a plan the owner had just paid $199 to own.
  const runningOutPro = () =>
    payload({
      effectivePlanId: "pro",
      creditWallet: wallet(500),
      subscription: subscription("pro", {
        cancel_at_period_end: true,
        // Midday, so the date reads October 10 in any test timezone.
        current_period_end: "2026-10-10T12:00:00.000Z",
      }),
    });

  it("says Lifetime, not $19/month and ACTIVE, while Pro runs out", async () => {
    await renderPlanCard(runningOutPro(), {
      kind: "granted",
      planIds: ["pro"],
    });

    expect(screen.getByText("Lifetime")).toBeInTheDocument();
    expect(screen.getByText("Lifetime access")).toBeInTheDocument();
    expect(screen.queryByText(/\$19\/month/)).toBeNull();
    expect(screen.queryByText("ACTIVE")).toBeNull();
  });

  it("names the Pro subscription it is running out, and offers no Reactivate", async () => {
    // s71 review M-2: the plan name comes from the catalogue the page already
    // holds, not from a fetch of its own.
    await renderPlanCard(runningOutPro(), {
      kind: "granted",
      planIds: ["pro"],
    });

    expect(
      screen.getByText(
        "Your Pro subscription ends October 10, 2026 — you won't be charged again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reactivate/i }),
    ).not.toBeInTheDocument();
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

describe("the empty payment-methods state on the billing page", () => {
  // s71 review m-2: PaymentMethodsCard's own test proves the copy switches on
  // `isPlanHeldForLife`; this proves the page actually passes it. Without the
  // prop the card falls back to offering a lifetime owner a subscription.
  it("tells a lifetime owner a card is for AI credits", async () => {
    await renderPlanCard(payload({ creditWallet: wallet(250) }), {
      kind: "granted",
      planIds: ["agency"],
    });

    expect(
      screen.getByText("Add a card to buy AI credits"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/start a subscription/i)).toBeNull();
  });

  it("keeps the subscription copy for an account with no grant", async () => {
    await renderPlanCard(
      payload({
        creditWallet: wallet(1000),
        subscription: subscription("agency"),
      }),
      { kind: "none" },
    );

    expect(
      screen.getByText("Add a card to start a subscription or buy AI credits"),
    ).toBeInTheDocument();
  });
});
