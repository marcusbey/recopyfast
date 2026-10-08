import React from "react";
import { render, screen, within } from "@testing-library/react";
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

function renderCard(props: {
  plan: SubscriptionPlan;
  isLifetime: boolean;
  subscription?: Subscription;
}) {
  const { container } = render(
    <SubscriptionCard
      subscription={props.subscription}
      plan={props.plan}
      isLifetime={props.isLifetime}
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
    // the period already paid for, and the period rows below still show it.
    const { header } = renderCard({
      plan: AGENCY,
      isLifetime: true,
      subscription: subscription("pro"),
    });

    expect(within(header).getByText("Lifetime")).toBeInTheDocument();
    expect(within(header).queryByText("ACTIVE")).toBeNull();
    expect(screen.getByText("Current period")).toBeInTheDocument();
  });

  it("shows no badge rather than a wrong one with neither", () => {
    // e.g. a trial, which confers the plan without a subscription row.
    const { card, header } = renderCard({ plan: PRO, isLifetime: false });

    // The header row holds the title block and nothing else.
    expect(header.textContent).toBe(`Current subscription${PRO.description}`);
    expect(card).not.toHaveTextContent(/\bFree\b/);
  });
});
