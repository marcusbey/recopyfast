import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  render(
    <BillingDashboard
      lifetimeGrant={{ kind: "none" }}
      foundingAgencyAvailability={null}
    />,
  );
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

/**
 * s47a — the founding offer on the billing page (docs/designs/
 * s47a-founding-20-grant.md, screens 2 and 3). While it runs, the trial card
 * carries the offer's copy and its action row. Once it ends, the lapsed panel
 * names the offer instead of a 14-day trial. Nothing here pins how many
 * actions the lapsed panel has: s49 adds one.
 */
describe("the founding offer on the billing page", () => {
  const OFFER_TRIAL = {
    daysRemaining: 64,
    endsAt: "2026-12-26T15:00:00.000Z",
    creditsUsed: 12,
    creditsLimit: 100,
    offerId: "founding_20" as const,
  };

  it("shows the offer card, priced from the catalogue, above the page", async () => {
    renderDashboard(payload({ effectivePlanId: "pro", trial: OFFER_TRIAL }));

    expect(
      await screen.findByText("Founding offer — 64 days left"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("of 100 AI credits used this month"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Need more AI now\? 1,000 credits for \$19\./),
    ).toBeInTheDocument();
  });

  it("opens the plans from the offer card's Choose a plan", async () => {
    const user = userEvent.setup();
    renderDashboard(payload({ effectivePlanId: "pro", trial: OFFER_TRIAL }));

    await user.click(
      await screen.findByRole("button", { name: "Choose a plan" }),
    );

    // The same UpgradeDialog the header's "Change plan" opens. With no
    // subscription it is "Choose your plan" and leads to Checkout; "Change your
    // plan" here was PR #49 finding 1 (BillingDashboard.plan-change.test.tsx).
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /choose your plan/i }),
    ).toBeInTheDocument();
  });

  it("tells an account whose offer ended that it ended, and that nothing was charged", async () => {
    renderDashboard(
      payload({ everTrialed: true, endedOfferId: "founding_20" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your founding offer has ended",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your 90 days of free Pro are over, and nothing was charged. Your site keeps serving its current content — editing, new sites and collaborators need Pro. AI credits come with a plan.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your 14-day pro trial has ended/i)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: /your trial has ended/i }),
    ).toBeNull();
  });

  it("still opens the plans from the ended-offer panel", async () => {
    const user = userEvent.setup();
    renderDashboard(
      payload({ everTrialed: true, endedOfferId: "founding_20" }),
    );

    await user.click(
      await screen.findByRole("button", { name: /upgrade to pro/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /choose your plan/i }),
    ).toBeInTheDocument();
  });

  it("keeps credits ahead of an ended offer", async () => {
    renderDashboard(
      payload({
        everTrialed: true,
        endedOfferId: "founding_20",
        creditWallet: { ...EMPTY_WALLET, balance: 250, purchased: 250 },
      }),
    );

    expect(
      await screen.findByRole("heading", { name: /you're on credits/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/founding offer has ended/i)).toBeNull();
  });
});

describe("the no-plan panels and AI credits (s51)", () => {
  // AI spend happens only inside editing, and editing needs a plan, so a
  // credit sold to an account with no plan could not be spent. The checkout
  // route refuses it; these screens must not offer it, and must say why.
  const NO_PLAN_VARIANTS: Array<
    [string, Partial<BillingDashboardData>, RegExp]
  > = [
    [
      "credits",
      {
        everTrialed: false,
        creditWallet: { ...EMPTY_WALLET, balance: 250, purchased: 250 },
      },
      /you're on credits/i,
    ],
    ["lapsed", { everTrialed: true }, /your trial has ended/i],
    [
      "ended founding offer",
      { everTrialed: true, endedOfferId: "founding_20" },
      /your founding offer has ended/i,
    ],
    ["never-trialled", { everTrialed: false }, /choose a plan to continue/i],
  ];

  it.each(NO_PLAN_VARIANTS)(
    "no-plan screens render no credit purchase control (%s)",
    async (_variant, overrides, heading) => {
      renderDashboard(payload(overrides));

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /buy credits/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /credit/i })).toBeNull();
    },
  );

  it("the purchase control the no-plan screens omit is the one a plan holder sees", async () => {
    // Control for the test above: the same query finds it where it belongs,
    // so its absence there is not an artefact of the query.
    renderDashboard(payload({ effectivePlanId: "pro" }));

    expect(
      await screen.findByRole("button", { name: /buy credits/i }),
    ).toBeInTheDocument();
  });

  it.each(NO_PLAN_VARIANTS)(
    "each no-plan screen says AI credits come with a plan (%s)",
    async (_variant, overrides, heading) => {
      renderDashboard(payload(overrides));

      await screen.findByRole("heading", { name: heading });
      expect(
        screen.getByText(/AI credits come with a plan/),
      ).toBeInTheDocument();
    },
  );

  it("a credits holder is told the credits are kept and work again with a plan", async () => {
    renderDashboard(
      payload({
        everTrialed: false,
        creditWallet: { ...EMPTY_WALLET, balance: 250, purchased: 250 },
      }),
    );

    const body = await screen.findByText(/250 credits/);
    expect(body).toHaveTextContent(
      /are kept and work again once you choose a plan/i,
    );
    expect(body).not.toHaveTextContent(/to spend on AI suggestions/i);
  });
});
