import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SubscriptionCard } from "../SubscriptionCard";
import type { SubscriptionPlan } from "@/lib/stripe/plan-types";
import type { Subscription } from "@/types/billing";

/**
 * s82 (s45 review #2): the plan card's allowance bullet, with the catalogue's
 * real Pro wording.
 *
 * A founding-offer holder holds Pro metered at 100 AI credits a month (ADR
 * 039) and gets this card with `monthlyCredits` 100. The card looked for the
 * phrase "500 AI credits"; Pro's live bullet is "AI rewrite suggestions, 500
 * credits a month", so nothing matched and the card printed 500 beside a
 * wallet saying 100.
 */

/** Pro as 20260802000000 seeds it and 20260928130000 words it. */
const PRO: SubscriptionPlan = {
  id: "pro",
  name: "Pro",
  description: "Up to 5 websites, all features, +$5 per additional website",
  price: 19,
  yearlyPrice: 15.77,
  features: [
    "Up to 5 websites",
    "+$5 per additional website",
    "Draft, then publish",
    "Click-to-edit interface",
    "Version snapshots and restore",
    "Email support",
    "AI rewrite suggestions, 500 credits a month",
  ],
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

function renderFeatures(monthlyCredits: number | null) {
  render(
    <SubscriptionCard
      plan={PRO}
      isLifetime={false}
      monthlyCredits={monthlyCredits}
      onUpdate={jest.fn()}
    />,
  );
  const heading = screen.getByRole("heading", { name: /plan features/i });
  return within(heading.parentElement as HTMLElement);
}

describe("the plan card's allowance bullet, in the catalogue's own words", () => {
  it("tells a founding-offer holder the 100 they get, never Pro's 500", () => {
    const features = renderFeatures(100);

    expect(
      features.getByText("AI rewrite suggestions, 100 credits a month"),
    ).toBeInTheDocument();
    expect(features.queryByText(/500 credits/)).toBeNull();
    expect(features.getAllByRole("listitem")).toHaveLength(7);
  });

  it("keeps Pro's bullet as written for a Pro subscriber", () => {
    const features = renderFeatures(500);

    expect(
      features.getByText("AI rewrite suggestions, 500 credits a month"),
    ).toBeInTheDocument();
  });
});

/**
 * s82 (s71 review N-1): a Founding Agency owner still running out an Agency
 * subscription reads "1,000 AI credits / month" — true while it runs — and
 * nothing said it drops to 250 when it ends (ADR 038). The running-out row and
 * the cancel confirmation now say what the allowance becomes, when the server
 * says the subscription is what raises it.
 */
describe("the running-out row says what the allowance becomes", () => {
  // Midday, so the date reads October 10 in any test timezone.
  const PERIOD_END = "2026-10-10T12:00:00.000Z";
  const AGENCY: SubscriptionPlan = {
    ...PRO,
    id: "agency",
    name: "Agency",
    price: 49,
    features: ["10 client websites", "1,000 AI credits / month"],
    limits: { ...PRO.limits, websites: 10, monthlyCredits: 1000 },
  };

  function agencySubscription(
    overrides: Partial<Subscription> = {},
  ): Subscription {
    return {
      id: "sub-row-1",
      user_id: "user-1",
      customer_id: "cus-row-1",
      stripe_subscription_id: "sub_1",
      plan_id: "agency",
      status: "active",
      current_period_start: "2026-09-10T12:00:00.000Z",
      current_period_end: PERIOD_END,
      cancel_at_period_end: true,
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-09-10T00:00:00.000Z",
      ...overrides,
    };
  }

  function renderRunningOut(
    subscription: Subscription,
    includedAfterSubscription?: number,
  ) {
    render(
      <SubscriptionCard
        subscription={subscription}
        plan={AGENCY}
        isLifetime
        subscriptionPlanName="Agency"
        monthlyCredits={1000}
        includedAfterSubscription={includedAfterSubscription}
        onUpdate={jest.fn()}
      />,
    );
  }

  it("says the allowance after a subscription set to cancel", () => {
    renderRunningOut(agencySubscription(), 250);

    expect(
      screen.getByText(
        "Your Agency subscription ends October 10, 2026 — you won't be charged again. Without it, your plan includes 250 AI credits a month.",
      ),
    ).toBeInTheDocument();
    // The bullets still state what is in force today.
    expect(screen.getByText("1,000 AI credits / month")).toBeInTheDocument();
  });

  it("says it after a renewing subscription, and in the cancel confirmation", () => {
    renderRunningOut(agencySubscription({ cancel_at_period_end: false }), 250);

    expect(
      screen.getByText(
        "Your Agency subscription renews October 10, 2026 — you hold Agency for life, so you no longer need it. Without it, your plan includes 250 AI credits a month.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel Subscription" }),
    );

    expect(
      screen.getByText(
        "Cancel your Agency subscription? You keep Agency for life, and you will not be charged again. Without it, your plan includes 250 AI credits a month.",
      ),
    ).toBeInTheDocument();
  });

  it("says it after a past-due subscription", () => {
    renderRunningOut(agencySubscription({ status: "past_due" }), 250);

    expect(
      screen.getByText(
        "Your Agency subscription is past due and ends October 10, 2026 — it will not renew. Without it, your plan includes 250 AI credits a month.",
      ),
    ).toBeInTheDocument();
  });

  it("adds nothing when the server sent no lower allowance", () => {
    renderRunningOut(agencySubscription());

    expect(
      screen.getByText(
        "Your Agency subscription ends October 10, 2026 — you won't be charged again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Without it/)).toBeNull();
  });
});
