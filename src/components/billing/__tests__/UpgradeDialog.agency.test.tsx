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
  oneTimeProducts: [],
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
        catalogue={CATALOGUE}
        lifetimeOffer={null}
        foundingAgencyAvailability={null}
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /Agency/i })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Yearly/i }));

    expect(screen.getByText("$40.83")).toBeInTheDocument();
    expect(screen.getByText("Billed $490 once a year")).toBeInTheDocument();
  });
});
