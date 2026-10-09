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

/**
 * s82 review, finding 5: the held-for-life submit guard was only ever tested
 * with `currentPlan` equal to the held plan, where `currentPlan ===
 * selectedPlan` disables the button on its own. Here the two differ, so only
 * the held-for-life clause stands between the click and a checkout.
 */
describe("UpgradeDialog, a plan held for life that is not the current plan", () => {
  it("still cannot be bought", async () => {
    const user = userEvent.setup();
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        currentPlan={null}
        hasSubscription={false}
        catalogue={CATALOGUE}
        lifetimeOffers={[]}
        foundingAgencyAvailability={null}
        agencyCheckoutEnabled
        heldForLife={{ planId: "agency", monthlyCredits: 250 }}
        onSuccess={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /^Agency/ }));
    const submit = screen.getByRole("button", {
      name: "You hold Agency for life",
    });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(startCheckout).not.toHaveBeenCalled();
  });
});

/**
 * s82 review, finding 1: the dialog refused only the plan held for life. A
 * lower plan — Starter or Pro under Founding Agency, Starter under Lifetime
 * Pro, or Pro under Lifetime Pro while an Agency subscription runs — stayed
 * buyable at its monthly price, and the server now refuses it (409). The
 * dialog says the same thing first: the tile reads "Included", and the submit
 * names the lifetime plan that includes it.
 */
describe("UpgradeDialog, plans a lifetime grant already includes", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    startCheckout.mockClear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function renderFor(props: {
    currentPlan: string | null;
    hasSubscription: boolean;
    grantedPlanIds: readonly string[];
    grantEndsAt?: Readonly<Partial<Record<string, string>>>;
    heldForLife?: { planId: string; monthlyCredits: number | null };
  }) {
    render(
      <UpgradeDialog
        open
        onOpenChange={jest.fn()}
        catalogue={CATALOGUE}
        lifetimeOffers={[]}
        foundingAgencyAvailability={null}
        agencyCheckoutEnabled
        onSuccess={jest.fn()}
        {...props}
      />,
    );
  }

  it("marks a lower plan Included, without a price, for a Lifetime Pro owner paying for Agency", async () => {
    const user = userEvent.setup();
    renderFor({
      currentPlan: "agency",
      hasSubscription: true,
      grantedPlanIds: ["pro"],
    });

    const pro = screen.getByRole("radio", { name: /^Pro/ });
    expect(pro).toHaveTextContent("Included");
    expect(pro).toHaveTextContent("Included for life");
    expect(pro).not.toHaveTextContent("$19");
    expect(pro).not.toHaveTextContent("/month");

    await user.click(pro);
    const submit = screen.getByRole("button", {
      name: "Included in your lifetime Pro",
    });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses Starter to the same owner, naming the lifetime plan that includes it", async () => {
    const user = userEvent.setup();
    renderFor({
      currentPlan: "agency",
      hasSubscription: true,
      grantedPlanIds: ["pro"],
    });

    await user.click(screen.getByRole("radio", { name: /^Starter/ }));

    expect(
      screen.getByRole("button", { name: "Included in your lifetime Pro" }),
    ).toBeDisabled();
  });

  it("refuses Pro to a Founding Agency owner with nothing billing", async () => {
    const user = userEvent.setup();
    renderFor({
      currentPlan: "agency",
      hasSubscription: false,
      grantedPlanIds: ["agency"],
      heldForLife: { planId: "agency", monthlyCredits: 250 },
    });

    await user.click(screen.getByRole("radio", { name: /^Pro/ }));
    const submit = screen.getByRole("button", {
      name: "Included in your lifetime Agency",
    });
    await user.click(submit);

    expect(submit).toBeDisabled();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  // s82 review (second pass), m2: an account can hold several grants —
  // Lifetime Pro, then Founding Agency (ADR 038). The submit names the highest
  // one, which includes every lower plan; the grants arrive in database order,
  // not rank order.
  it("names the highest plan held for life when several grants include it", async () => {
    const user = userEvent.setup();
    renderFor({
      currentPlan: "agency",
      hasSubscription: false,
      grantedPlanIds: ["agency", "pro"],
      heldForLife: { planId: "agency", monthlyCredits: 250 },
    });

    await user.click(screen.getByRole("radio", { name: /^Starter/ }));

    expect(
      screen.getByRole("button", { name: "Included in your lifetime Agency" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Included in your lifetime Pro" }),
    ).toBeNull();
  });

  // s82 review (second pass), m3: "for life" was said for a plan included
  // only by a grant that ends — production holds one (the QA recovery grant,
  // `qa_recovery_20260919`). A dated grant is not a lifetime one: the tile and
  // the submit say until when.
  describe("when the grant that includes the plan has an end date", () => {
    // Midday UTC, so the printed day is the same in every test runner's zone.
    const ENDS_AT = "2026-11-19T12:00:00.000Z";

    it("says until when, never for life", async () => {
      const user = userEvent.setup();
      renderFor({
        currentPlan: "pro",
        hasSubscription: false,
        grantedPlanIds: ["pro"],
        grantEndsAt: { pro: ENDS_AT },
        heldForLife: { planId: "pro", monthlyCredits: 500 },
      });

      const starter = screen.getByRole("radio", { name: /^Starter/ });
      expect(starter).toHaveTextContent("Included");
      expect(starter).toHaveTextContent("Included until November 19, 2026");
      expect(starter).not.toHaveTextContent("for life");
      expect(starter).not.toHaveTextContent("$9");

      await user.click(starter);
      const submit = screen.getByRole("button", {
        name: "Included in your plan until November 19, 2026",
      });
      await user.click(submit);

      expect(submit).toBeDisabled();
      expect(startCheckout).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /lifetime/i })).toBeNull();
    });

    it("says the latest end when several dated grants include the plan", async () => {
      const user = userEvent.setup();
      renderFor({
        currentPlan: "agency",
        hasSubscription: false,
        grantedPlanIds: ["agency", "pro"],
        grantEndsAt: { agency: "2026-10-20T12:00:00.000Z", pro: ENDS_AT },
      });

      const starter = screen.getByRole("radio", { name: /^Starter/ });
      expect(starter).toHaveTextContent("Included until November 19, 2026");

      await user.click(starter);

      expect(
        screen.getByRole("button", {
          name: "Included in your plan until November 19, 2026",
        }),
      ).toBeDisabled();
    });

    it("says for life when an undated grant includes the plan too, and names that grant", async () => {
      const user = userEvent.setup();
      // Lifetime Pro (no end) beside a dated Agency grant: Starter and Pro
      // are included for life by Pro — not by the Agency grant, which ends.
      renderFor({
        currentPlan: "agency",
        hasSubscription: false,
        grantedPlanIds: ["agency", "pro"],
        grantEndsAt: { agency: ENDS_AT },
      });

      expect(screen.getByRole("radio", { name: /^Pro/ })).toHaveTextContent(
        "Included for life",
      );
      const starter = screen.getByRole("radio", { name: /^Starter/ });
      expect(starter).toHaveTextContent("Included for life");
      expect(starter).not.toHaveTextContent("until");

      await user.click(starter);

      expect(
        screen.getByRole("button", { name: "Included in your lifetime Pro" }),
      ).toBeDisabled();
    });
  });

  it("still sells Agency to a Lifetime Pro owner: a higher plan is not included", async () => {
    const user = userEvent.setup();
    renderFor({
      currentPlan: "pro",
      hasSubscription: false,
      grantedPlanIds: ["pro"],
      heldForLife: { planId: "pro", monthlyCredits: 500 },
    });

    const agency = screen.getByRole("radio", { name: /^Agency/ });
    expect(agency).toHaveTextContent("$49");
    expect(agency).not.toHaveTextContent("Included");

    await user.click(agency);
    await user.click(
      screen.getByRole("button", { name: "Continue to payment — $49" }),
    );

    expect(startCheckout).toHaveBeenCalledWith({
      intent: "subscription",
      planId: "agency",
      billingPeriod: "monthly",
    });
  });
});
