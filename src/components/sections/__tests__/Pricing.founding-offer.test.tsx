import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { FoundingOfferView } from "@/hooks/useFoundingOffer";

// The terms guard below reads s47a's own constants. Their modules reach the
// service-role client and the resolver, neither of which a component test
// may touch.
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

jest.mock("@/lib/billing/effective-plan", () => {
  const actual = jest.requireActual("@/lib/billing/effective-plan");
  return { ...actual, resolveEntitlement: jest.fn() };
});

import { FOUNDING_OFFER_TERMS } from "@/lib/billing/founding-offer";
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial";
import Pricing from "../Pricing";

/**
 * s47b — the founding-offer card in the pricing section.
 *
 * It renders only while spots remain. Loading and closed (sold out or unknown)
 * render nothing in its place: no skeleton, no "unavailable" line, no number.
 */

const HEADLINE = "First 20 users get ReCopyFast Pro free for 3 months";
const AFTER_90_DAYS =
  "After 90 days, choose a plan to keep editing. Your site keeps serving its content either way.";
const SIGN_UP_ORDER =
  "Spots go in sign-up order. If all 20 are taken when you sign up, you get the 14-day Pro trial instead.";

const OPEN: FoundingOfferView = { status: "open", remaining: 17, limit: 20 };
const LAST: FoundingOfferView = { status: "open", remaining: 1, limit: 20 };
const LOADING: FoundingOfferView = { status: "loading" };
const CLOSED: FoundingOfferView = { status: "closed" };

function creditsProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "credits",
    name: "Credits",
    description: "AI credits",
    price: 19,
    features: [],
    grantsPlanId: null,
    creditsPerPack: 1000,
    ...overrides,
  };
}

function pricingResponse(oneTimeProducts: unknown[] = [creditsProduct()]) {
  return { plans: [], oneTimeProducts, foundingAgencyAvailability: null };
}

const FAILED = Symbol("failed");

function mockFetch(pricing: unknown) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== "/api/pricing") {
      throw new Error(`Unexpected request to ${url}`);
    }
    if (pricing === FAILED) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "Pricing is temporarily unavailable" }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => pricing } as Response;
  }) as typeof fetch;
}

async function pricingSettled() {
  await waitFor(() =>
    expect(
      screen.queryByRole("status", { name: "Loading pricing" }),
    ).not.toBeInTheDocument(),
  );
}

function sectionText(container: HTMLElement): string {
  return container.querySelector("#pricing")?.textContent ?? "";
}

beforeEach(() => {
  mockFetch(pricingResponse());
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Pricing founding-offer card", () => {
  it("shows the offer card between the subtitle and the billing toggle while spots remain", async () => {
    render(<Pricing offer={OPEN} />);
    await pricingSettled();

    const heading = screen.getByRole("heading", { level: 3, name: HEADLINE });
    expect(screen.getByText("Founding offer")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("for 3 months")).toBeInTheDocument();
    expect(screen.getByText("17 of 20 spots left")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Claim your spot" }),
    ).toHaveAttribute("href", "/signup");
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "5 websites",
      "Invited editors",
      "All sites view",
      "AI suggestions",
      "100 AI credits a month",
      "No credit card required",
    ]);

    const subtitle = screen.getByText(
      "Choose the plan that fits your needs. Upgrade anytime.",
    );
    const monthly = screen.getByRole("button", { name: "Monthly" });
    expect(
      subtitle.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(monthly) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("last spot: 'Last spot left — 1 of 20', and nothing else changes", async () => {
    const open = render(<Pricing offer={OPEN} />);
    await pricingSettled();
    const openText = sectionText(open.container);
    open.unmount();

    const last = render(<Pricing offer={LAST} />);
    await pricingSettled();

    expect(screen.getByText("Last spot left — 1 of 20")).toBeInTheDocument();
    expect(screen.queryByText(/1 of 20 spots left/)).not.toBeInTheDocument();
    expect(sectionText(last.container)).toBe(
      openText.replace("17 of 20 spots left", "Last spot left — 1 of 20"),
    );
  });

  it.each([
    ["loading", LOADING],
    ["closed", CLOSED],
  ])(
    "renders no card, no placeholder and no number (%s)",
    async (_state, offer) => {
      const { container } = render(<Pricing offer={offer} />);
      await pricingSettled();

      expect(screen.queryByText("Founding offer")).not.toBeInTheDocument();
      expect(screen.queryByText("Claim your spot")).not.toBeInTheDocument();
      expect(container.querySelector(".animate-pulse")).toBeNull();
      expect(sectionText(container)).not.toMatch(/of 20/);
    },
  );

  it("names the pack from the pricing payload", async () => {
    const first = render(<Pricing offer={OPEN} />);

    expect(
      await screen.findByText(
        `${AFTER_90_DAYS} Need more AI before then? 1,000 credits for $19.`,
      ),
    ).toBeInTheDocument();
    first.unmount();

    mockFetch(
      pricingResponse([creditsProduct({ price: 9, creditsPerPack: 500 })]),
    );
    const second = render(<Pricing offer={OPEN} />);

    expect(
      await screen.findByText(
        `${AFTER_90_DAYS} Need more AI before then? 500 credits for $9.`,
      ),
    ).toBeInTheDocument();
    expect(sectionText(second.container)).not.toContain("1,000");
  });

  it.each<[string, unknown]>([
    ["the pricing request failed", FAILED],
    ["there is no credits product", pricingResponse([])],
    [
      "the credits product has no creditsPerPack",
      pricingResponse([creditsProduct({ creditsPerPack: undefined })]),
    ],
  ])("drops only the pack sentence when %s", async (_case, pricing) => {
    mockFetch(pricing);
    const { container } = render(<Pricing offer={OPEN} />);
    await pricingSettled();
    if (pricing === FAILED) {
      await screen.findByText("We could not load our plans just now.");
    }

    expect(screen.getByText(AFTER_90_DAYS)).toBeInTheDocument();
    expect(screen.getByText(SIGN_UP_ORDER)).toBeInTheDocument();
    expect(sectionText(container)).not.toContain("Need more AI");
  });

  /**
   * The card states three numbers the product enforces elsewhere. It cannot
   * import them — the modules that hold them reach the service-role client —
   * so this ties each one to its source instead.
   */
  it("promises the grant's own terms", async () => {
    const { container } = render(<Pricing offer={OPEN} />);
    await pricingSettled();
    const text = sectionText(container);

    const monthlyCredits = FOUNDING_OFFER_TERMS.founding_20.monthlyCredits;
    expect(
      screen.getByText(`${monthlyCredits} AI credits a month`),
    ).toBeInTheDocument();
    expect(text).toContain(`with ${monthlyCredits} AI credits a month.`);

    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260928120000_founding_offer.sql",
      ),
      "utf8",
    );
    const grantDays = migration.match(/NOW\(\) \+ INTERVAL '(\d+) days'/)?.[1];
    expect(grantDays).toBeDefined();
    expect(text).toContain(`Every Pro feature for ${grantDays} days`);
    expect(text).toContain(`After ${grantDays} days, choose a plan`);

    expect(text).toContain(`you get the ${TRIAL_DURATION_DAYS}-day Pro trial`);
  });
});
