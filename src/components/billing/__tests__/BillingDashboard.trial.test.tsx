import React from "react";
import { render, screen } from "@testing-library/react";
import { BillingDashboard } from "../BillingDashboard";
import type { BillingDashboardData } from "@/types/billing";

/**
 * The billing page's two trial-shaped states.
 *
 * While the trial runs, the status card sits above everything else. Once it
 * ends, the account is unentitled and lands on the same panel every unpaid
 * account lands on — but the panel now has two things to say, and which one is
 * right depends on whether this reader ever had a trial. Both are
 * `effectivePlanId: null`; nothing else tells them apart.
 */

jest.mock("../CheckoutStatusBanner", () => ({
  CheckoutStatusBanner: () => null,
}));

const PRO = {
  id: "pro",
  name: "Pro",
  description: "",
  price: 19,
  yearlyPrice: 15.77,
  features: [],
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

const CATALOGUE = {
  subscriptions: [PRO],
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

function payload(
  overrides: Partial<BillingDashboardData> = {},
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
    effectivePlanId: null,
    trial: null,
    everTrialed: false,
    ...overrides,
  } as BillingDashboardData;
}

function renderDashboard(data: BillingDashboardData) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => data,
  });
  render(<BillingDashboard lifetimeGrant={{ kind: "none" }} />);
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the expired-trial panel", () => {
  it("tells a lapsed trialist their site is still serving", async () => {
    renderDashboard(payload({ everTrialed: true }));

    expect(
      await screen.findByRole("heading", { name: /your trial has ended/i }),
    ).toBeInTheDocument();
    // AC 4, said out loud: a customer landing here needs to know their site did
    // not just go down.
    expect(
      screen.getByText(/your site keeps serving its current content/i),
    ).toBeInTheDocument();
  });

  it("offers one action and nothing beside it", async () => {
    renderDashboard(payload({ everTrialed: true }));

    expect(
      await screen.findByRole("button", { name: /upgrade to pro/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^see plans$/i })).toBeNull();
  });

  it("keeps the never-subscribed copy for an account that never trialled", async () => {
    renderDashboard(payload({ everTrialed: false }));

    expect(
      await screen.findByRole("heading", {
        name: /choose a plan to continue/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your trial has ended/i)).toBeNull();
  });

  it("does not claim a trial ended for a credit holder who never had one", async () => {
    renderDashboard(
      payload({
        everTrialed: false,
        creditWallet: { ...EMPTY_WALLET, balance: 250, purchased: 250 },
      }),
    );

    expect(
      await screen.findByRole("heading", { name: /you're on credits/i }),
    ).toBeInTheDocument();
  });
});

describe("the trial status card on the billing page", () => {
  it("sits above the page for an account still inside its trial", async () => {
    renderDashboard(
      payload({
        effectivePlanId: "pro",
        trial: {
          daysRemaining: 9,
          endsAt: "2026-08-30T09:00:00.000Z",
          creditsUsed: 120,
          creditsLimit: 500,
        },
      }),
    );

    expect(
      await screen.findByText(/9 days left in your trial/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/of 500 trial AI credits used/i),
    ).toBeInTheDocument();
  });

  it("is absent for a paying customer", async () => {
    renderDashboard(payload({ effectivePlanId: "pro", trial: null }));

    await screen.findByRole("heading", { name: /billing & subscription/i });
    expect(screen.queryByText(/left in your trial/i)).toBeNull();
  });
});
