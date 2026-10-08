import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { BillingDashboard } from "../BillingDashboard";
import type { BillingDashboardData } from "@/types/billing";

/**
 * s66b1 AC 3 / AC 4 — Billing keeps one frame, on the shared edge, in all five
 * of its states.
 *
 * Every state used to return its own `container mx-auto px-4 py-8` inside the
 * layout's column, so Billing's title sat 16px right of every other page's
 * (s66 research, fact 5), and only the ready state had the page title at all:
 * the no-plan panel promoted its own heading to the page's h1. Now
 * `BillingDashboard` renders one `PageShell` around a state-switched body, the
 * no-plan heading is an h2 under the page's h1, and no `container` is left.
 *
 * Mocks follow BillingDashboard.trial.test.tsx.
 */

jest.mock("../CheckoutStatusBanner", () => ({
  CheckoutStatusBanner: () => null,
}));

const PRO = {
  id: "pro",
  name: "Pro",
  description: "Up to 5 websites",
  price: 19,
  yearlyPrice: 15.77,
  features: ["Up to 5 websites"],
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

function renderDashboard(): void {
  render(
    <BillingDashboard
      lifetimeGrant={{ kind: "none" }}
      foundingAgencyAvailability={null}
    />,
  );
}

function respondWith(data: BillingDashboardData): void {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

/** One page title, in the shell's header, and no page container anywhere. */
function expectOneBillingFrame(): void {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName("Billing & subscription");
  expect(headings[0].closest("[data-page-header]")).not.toBeNull();
  expect(document.querySelector(".container")).toBeNull();
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("BillingDashboard frame", () => {
  it("renders one h1 while the billing data loads", () => {
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderDashboard();

    expectOneBillingFrame();
  });

  it("renders one h1 when the billing data cannot be loaded", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    renderDashboard();

    expect(
      await screen.findByText("Error loading billing data"),
    ).toBeInTheDocument();
    expectOneBillingFrame();
  });

  it("renders one h1 for an account with no plan, its panel heading an h2", async () => {
    respondWith(payload({ effectivePlanId: null }));
    renderDashboard();

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Choose a plan to continue",
      }),
    ).toBeInTheDocument();
    expectOneBillingFrame();
  });

  it("renders one h1 when the plan in force is missing from the catalogue", async () => {
    respondWith(
      payload({
        effectivePlanId: "pro",
        catalogue: { ...CATALOGUE, subscriptions: [] },
      }),
    );
    renderDashboard();

    expect(
      await screen.findByText("Plan catalogue unavailable"),
    ).toBeInTheDocument();
    expectOneBillingFrame();
  });

  it("renders one h1 on the ready dashboard, with its plan actions in the header", async () => {
    respondWith(payload({ effectivePlanId: "pro" }));
    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: /plan features/i }),
    ).toBeInTheDocument();
    expectOneBillingFrame();
    const header = document.querySelector("[data-page-header]");
    expect(header).toContainElement(
      screen.getByRole("button", { name: "Change plan" }),
    );
    expect(header).toContainElement(screen.getByText("PRO PLAN"));
  });
});
