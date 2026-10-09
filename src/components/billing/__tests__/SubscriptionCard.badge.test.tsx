import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SubscriptionCard } from "../SubscriptionCard";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import type { Subscription } from "@/types/billing";

/**
 * s71: the plan card's status badge, in every state the card can be in.
 *
 * Owner, 2026-10-08: "it says FRee on the right and PRO on the left." A
 * lifetime grant has no subscription row, and the badge printed "Free" whenever
 * there was none — so every lifetime owner read "Free" beside "Pro plan ·
 * Lifetime access", the plan they paid for. "Free" names a retired plan nobody
 * is on: no state of this card may print it.
 */

const PRO: SubscriptionPlan = {
  id: "pro",
  name: "Pro",
  description: "Up to 5 websites, all features, +$5 per additional website",
  price: 19,
  yearlyPrice: 15.77,
  features: ["Up to 5 websites", "AI A/B copy testing"],
  limits: {
    websites: 5,
    collaborators: 5,
    aiFeatures: true,
    translations: -1,
    abTesting: true,
    monthlyCredits: 500,
  },
  additionalSitePrice: 5,
  sortOrder: 20,
};

const AGENCY: SubscriptionPlan = {
  ...PRO,
  id: "agency",
  name: "Agency",
  description: "10 client websites, unlimited invited editors, Agency support",
  price: 49,
  yearlyPrice: 40.83,
  yearlyTotal: 490,
  limits: {
    ...PRO.limits,
    websites: 10,
    collaborators: -1,
    monthlyCredits: 1000,
  },
  additionalSitePrice: 4,
  sortOrder: 25,
};

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

function renderCard(props: {
  plan: SubscriptionPlan;
  isLifetime: boolean;
  subscription?: Subscription;
  subscriptionPlanName?: string;
}) {
  const { container } = render(
    <SubscriptionCard
      subscription={props.subscription}
      plan={props.plan}
      isLifetime={props.isLifetime}
      subscriptionPlanName={props.subscriptionPlanName}
      monthlyCredits={props.plan.limits.monthlyCredits}
      onUpdate={jest.fn()}
    />,
  );
  // The badge sits in the card's header row, beside the title block.
  const title = screen.getByRole("heading", { name: "Current subscription" });
  const header = title.parentElement?.parentElement as HTMLElement;
  return { card: container, header };
}

describe("the plan card's status badge", () => {
  it("calls a plan held for life Lifetime, never Free", () => {
    const { card, header } = renderCard({ plan: PRO, isLifetime: true });

    expect(within(header).getByText("Lifetime")).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/\bFree\b/);
  });

  it("keeps a live subscription's status", () => {
    const { header } = renderCard({
      plan: PRO,
      isLifetime: false,
      subscription: subscription("pro"),
    });

    expect(within(header).getByText("ACTIVE")).toBeInTheDocument();
    expect(within(header).queryByText("Lifetime")).toBeNull();
  });

  it("says Lifetime while a lower subscription runs out its period", () => {
    // The plan in force is the one held for life; the Pro row only finishes
    // the period already paid for, and its own named row below still shows it
    // (s71 review M-2: it used to be an unlabelled "Current period" grid).
    const { header } = renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro"),
      subscriptionPlanName: "Pro",
    });

    expect(within(header).getByText("Lifetime")).toBeInTheDocument();
    expect(within(header).queryByText("ACTIVE")).toBeNull();
    expect(
      screen.getByText(/^Your Pro subscription renews/),
    ).toBeInTheDocument();
  });

  it("says Lifetime while the lower subscription is set to cancel", () => {
    // The realistic case: buying a lifetime plan sets the subscription it
    // replaces to cancel at period end (stopBillingForLifetimeOwner).
    const { header } = renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", { cancel_at_period_end: true }),
      subscriptionPlanName: "Pro",
    });

    expect(within(header).getByText("Lifetime")).toBeInTheDocument();
    expect(within(header).queryByText("ACTIVE")).toBeNull();
  });

  it("shows no badge rather than a wrong one with neither", () => {
    // e.g. a trial, which confers the plan without a subscription row.
    const { card, header } = renderCard({ plan: PRO, isLifetime: false });

    // The header row holds the title block and nothing else.
    expect(header.textContent).toBe(`Current subscription${PRO.description}`);
    expect(card).not.toHaveTextContent(/\bFree\b/);
  });
});

/**
 * s71 review M-2: a subscription still running out under a plan held for life.
 *
 * The card drew that subscription's rows unlabelled under the "Lifetime" badge
 * — "Next billing: Plan will be canceled" read as the lifetime plan being
 * cancelled — and offered "Reactivate Subscription", which would restart
 * billing for a plan the grant had replaced. The row now names the
 * subscription's own plan and says what happens to it.
 */
describe("a subscription running out under a plan held for life", () => {
  // Midday, so the date reads October 10 in any test timezone.
  const PERIOD_END = "2026-10-10T12:00:00.000Z";

  it("names its plan, says no further charge, and offers no Reactivate", () => {
    renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", {
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
      subscriptionPlanName: "Pro",
    });

    expect(
      screen.getByText(
        "Your Pro subscription ends October 10, 2026 — you won't be charged again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Plan will be canceled")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reactivate/i }),
    ).not.toBeInTheDocument();
  });

  it("names its plan and still offers Cancel when it would renew", () => {
    renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", { current_period_end: PERIOD_END }),
      subscriptionPlanName: "Pro",
    });

    expect(
      screen.getByText(
        "Your Pro subscription renews October 10, 2026 — you hold Agency for life, so you no longer need it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel Subscription" }),
    ).toBeInTheDocument();
  });

  // The confirmation promised "You keep access until <period end>" — untrue
  // when the plan is held for life: cancelling the lower subscription ends
  // nothing the owner keeps.
  it("confirms the cancel without ending access the owner holds for life", () => {
    renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", { current_period_end: PERIOD_END }),
      subscriptionPlanName: "Pro",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel Subscription" }),
    );

    expect(
      screen.getByText(
        "Cancel your Pro subscription? You keep Agency for life, and you will not be charged again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/keep access until/)).not.toBeInTheDocument();
  });

  it("keeps a past-due subscription's status on its row, not the badge", () => {
    const { header } = renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", {
        status: "past_due",
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
      subscriptionPlanName: "Pro",
    });

    // A failed payment is still being collected, so this row promises no
    // "won't be charged again" — only that it will not renew.
    expect(
      screen.getByText(
        "Your Pro subscription is past due and ends October 10, 2026 — it will not renew.",
      ),
    ).toBeInTheDocument();
    expect(within(header).getByText("Lifetime")).toBeInTheDocument();
    expect(within(header).queryByText("PAST DUE")).toBeNull();
  });

  it("keeps a trialing subscription's status on its row", () => {
    renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", {
        status: "trialing",
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
      subscriptionPlanName: "Pro",
    });

    expect(
      screen.getByText(
        "Your Pro subscription is trialing and ends October 10, 2026 — you won't be charged again.",
      ),
    ).toBeInTheDocument();
  });

  it("says 'Your previous subscription' when its plan is not in the catalogue", () => {
    renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro", {
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
    });

    expect(
      screen.getByText(
        "Your previous subscription ends October 10, 2026 — you won't be charged again.",
      ),
    ).toBeInTheDocument();
  });
});

describe("a subscription that bills the plan in force (not held for life)", () => {
  // Regression guards: the M-2 row is for the lifetime state only. A plain
  // subscriber's card keeps its period grid and its Reactivate action.
  const PERIOD_END = "2026-10-10T12:00:00.000Z";

  it("keeps the period grid and Cancel for an active subscription", () => {
    renderCard({
      plan: PRO,
      isLifetime: false,
      subscription: subscription("pro", { current_period_end: PERIOD_END }),
      subscriptionPlanName: "Pro",
    });

    expect(screen.getByText("Current period")).toBeInTheDocument();
    expect(screen.getByText("Next billing")).toBeInTheDocument();
    expect(screen.getByText("October 10, 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel Subscription" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Your Pro subscription/)).toBeNull();
  });

  it("keeps 'Plan will be canceled' and Reactivate for a cancelling one", () => {
    renderCard({
      plan: PRO,
      isLifetime: false,
      subscription: subscription("pro", {
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
      }),
      subscriptionPlanName: "Pro",
    });

    expect(screen.getByText("Plan will be canceled")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reactivate Subscription" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Your Pro subscription/)).toBeNull();
  });
});

describe("the plan card's price", () => {
  // s71 review m-3: the badge stopped saying "Free", but the price line still
  // did for any plan priced 0 — the same retired word, one row down.
  it("states a zero price as a price, never Free", () => {
    const { card } = renderCard({
      plan: { ...PRO, price: 0 },
      isLifetime: false,
    });

    expect(screen.getByText("$0/month")).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/\bFree\b/);
  });
});
