import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpgradeDialog } from "../UpgradeDialog";
import type { PlanCatalogue, SubscriptionPlan } from "@/lib/stripe/plan-types";

const startCheckout = jest.fn();

jest.mock("../useCheckout", () => ({
  useCheckout: () => ({
    startCheckout,
    isRedirecting: false,
    error: null,
    clearError: jest.fn(),
  }),
}));

function plan(
  id: SubscriptionPlan["id"],
  name: string,
  price: number,
  yearlyPrice: number,
  yearlyTotal: number,
): SubscriptionPlan {
  return {
    id,
    name,
    description: `${name} plan`,
    price,
    yearlyPrice,
    yearlyTotal,
    features: [`Everything in ${name}`],
    limits: {
      websites: 10,
      collaborators: -1,
      aiFeatures: true,
      translations: -1,
      abTesting: true,
      monthlyCredits: 1000,
    },
    additionalSitePrice: 4,
    sortOrder: 30,
  };
}

const CATALOGUE: PlanCatalogue = {
  subscriptions: [
    plan("starter", "Starter", 9, 7.5, 90),
    plan("pro", "Pro", 19, 15.75, 189),
    plan("agency", "Agency", 49, 40.83, 490),
  ],
  oneTimeProducts: [
    {
      id: "lifetime_pro",
      name: "Lifetime Pro",
      description: "Permanent Pro access",
      price: 199,
      features: ["Everything in Pro"],
      grantsPlanId: "pro",
      sortOrder: 40,
    },
    {
      id: "lifetime_agency",
      name: "Founding Agency (lifetime)",
      description: "Permanent Agency access",
      price: 299,
      features: ["Everything in Agency"],
      grantsPlanId: "agency",
      sortOrder: 45,
    },
  ],
  creditPack: {
    creditsPerPack: 1000,
    maxPacksPerPurchase: 100,
    pricePerPack: 10,
  },
};

describe("UpgradeDialog Agency plan", () => {
  it("offers Agency and states the exact annual charge", async () => {
    const user = userEvent.setup();
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        currentPlan={null}
        hasSubscription={false}
        catalogue={CATALOGUE}
        lifetimeOffers={CATALOGUE.oneTimeProducts}
        foundingAgencyAvailability={null}
        agencyCheckoutEnabled
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /Agency/i })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Yearly/i }));

    expect(screen.getByText("$40.83")).toBeInTheDocument();
    expect(screen.getByText("Billed $490 once a year")).toBeInTheDocument();
  });

  it("keeps Lifetime Pro visible beside a sold-out founding offer", () => {
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        currentPlan={null}
        hasSubscription={false}
        catalogue={CATALOGUE}
        lifetimeOffers={CATALOGUE.oneTimeProducts}
        foundingAgencyAvailability={{ remaining: 0, limit: 50, soldOut: true }}
        agencyCheckoutEnabled
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.getByText("Permanent Pro access")).toBeInTheDocument();
    expect(screen.getByText("Permanent Agency access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Buy once" })).toBeEnabled();
  });

  it("removes Agency purchase controls when the checkout kill switch is off", () => {
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        currentPlan={null}
        hasSubscription={false}
        catalogue={CATALOGUE}
        lifetimeOffers={CATALOGUE.oneTimeProducts}
        foundingAgencyAvailability={{
          remaining: 17,
          limit: 50,
          soldOut: false,
        }}
        agencyCheckoutEnabled={false}
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.queryByRole("radio", { name: /Agency/i })).toBeNull();
    expect(screen.queryByText(/Founding Agency \(lifetime\)/)).toBeNull();
    expect(screen.getByText("Permanent Pro access")).toBeInTheDocument();
  });
});

/**
 * s82 (s45 review #1): a lifetime owner opening "Change plan" saw the plan
 * they hold for life marked "Current" at "$49/month" with Agency's "1,000 AI
 * credits / month" — a subscription's price and semantics, beside a card that
 * says "Lifetime access" and 250. The tile now reads the way the card does.
 */
describe("UpgradeDialog, a plan held for life", () => {
  const AGENCY_WITH_ALLOWANCE: SubscriptionPlan = {
    ...plan("agency", "Agency", 49, 40.83, 490),
    features: ["Everything in Agency", "1,000 AI credits / month"],
  };
  const HELD_CATALOGUE: PlanCatalogue = {
    ...CATALOGUE,
    subscriptions: [
      plan("starter", "Starter", 9, 7.5, 90),
      plan("pro", "Pro", 19, 15.75, 189),
      AGENCY_WITH_ALLOWANCE,
    ],
  };

  function renderDialog(heldForLife?: {
    planId: string;
    monthlyCredits: number | null;
  }) {
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        currentPlan="agency"
        hasSubscription={false}
        catalogue={HELD_CATALOGUE}
        lifetimeOffers={[]}
        foundingAgencyAvailability={null}
        agencyCheckoutEnabled
        heldForLife={heldForLife}
        onSuccess={jest.fn()}
      />,
    );
    return screen.getByRole("radio", { name: /^Agency/ });
  }

  it("shows it as Lifetime access with the owner's own allowance, no price", async () => {
    const user = userEvent.setup();
    const tile = renderDialog({ planId: "agency", monthlyCredits: 250 });

    expect(tile).toHaveTextContent("Lifetime");
    expect(tile).toHaveTextContent("Lifetime access");
    expect(tile).not.toHaveTextContent("Current");
    expect(tile).not.toHaveTextContent("$49");
    expect(tile).not.toHaveTextContent("/month");
    expect(tile).toHaveTextContent("250 AI credits / month");
    expect(tile).not.toHaveTextContent("1,000 AI credits");

    await user.click(screen.getByRole("radio", { name: /Yearly/i }));

    expect(tile).not.toHaveTextContent("Billed $490 once a year");
    expect(tile).not.toHaveTextContent("$40.83");
  });

  it("cannot be bought: selecting it disables the submit, which names no price", async () => {
    const user = userEvent.setup();
    const tile = renderDialog({ planId: "agency", monthlyCredits: 250 });

    await user.click(tile);

    const submit = screen.getByRole("button", {
      name: "You hold Agency for life",
    });
    expect(submit).toBeDisabled();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("leaves every other tile priced as before", () => {
    renderDialog({ planId: "agency", monthlyCredits: 250 });

    expect(screen.getByRole("radio", { name: /^Pro/ })).toHaveTextContent(
      "$19",
    );
  });

  it("keeps Current and the price for a plan billed monthly", () => {
    const tile = renderDialog();

    expect(tile).toHaveTextContent("Current");
    expect(tile).toHaveTextContent("$49");
    expect(tile).toHaveTextContent("1,000 AI credits / month");
  });
});
