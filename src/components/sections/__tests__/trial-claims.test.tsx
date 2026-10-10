import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import type { FoundingOfferView } from "@/hooks/useFoundingOffer";
import Hero from "../Hero";
import FinalCTA from "../FinalCTA";
import Pricing from "../Pricing";

/**
 * The marketing claims this story makes true again.
 *
 * "14-day free trial" and "No credit card required" were deliberately deleted
 * from three sections, each with a tombstone comment recording why: there was
 * no trial and subscription Checkout always collected a card, so both were
 * promises the product broke. Restoring the copy is the visible half of this
 * story — and it is only honest while the trial actually exists, which is what
 * these tests are pinned to.
 *
 * The trial claims now follow the founding-offer count (s47b). While spots
 * remain, the first 20 accounts get 90 days instead of 14, so a line naming
 * "14 days" would undersell them, and one naming "3 months" would oversell
 * everyone after. Each claim below is asserted in all four states: loading
 * (promises neither), spots left, last spot, and sold out or unknown (the
 * 14-day trial, never a number).
 */

const LOADING: FoundingOfferView = { status: "loading" };
const OPEN: FoundingOfferView = { status: "open", remaining: 17, limit: 20 };
const LAST: FoundingOfferView = { status: "open", remaining: 1, limit: 20 };
const CLOSED: FoundingOfferView = { status: "closed" };

const ALL_STATES: Array<[string, FoundingOfferView]> = [
  ["loading", LOADING],
  ["spots left", OPEN],
  ["last spot", LAST],
  ["sold out or unknown", CLOSED],
];

function pillText(container: HTMLElement): string {
  const pill = container.querySelector('a[href="#pricing"]');
  expect(pill).not.toBeNull();
  return pill?.textContent ?? "";
}

/**
 * The pill's two lines, each on its own: `md` and up, and the phone line
 * (`md:hidden`). Reading the pill as one string cannot pin the phone line —
 * "14 days of Pro, free" is also a substring of the desktop line.
 */
function pillForms(container: HTMLElement): { desktop: string; phone: string } {
  const pill = container.querySelector('a[href="#pricing"]');
  const desktop = pill?.querySelector(".md\\:inline");
  const phone = pill?.querySelector(".md\\:hidden");
  expect(desktop).not.toBeNull();
  expect(phone).not.toBeNull();
  return {
    desktop: desktop?.textContent ?? "",
    phone: phone?.textContent ?? "",
  };
}

function heroText(container: HTMLElement): string {
  return container.querySelector("#hero")?.textContent ?? "";
}

// The first trust item per state, from the design's Copy table.
const TRUST_LEADS: Array<[string, FoundingOfferView]> = [
  ["Free trial", LOADING],
  ["3 months free for the first 20", OPEN],
  ["3 months free for the first 20", LAST],
  ["14-day free trial", CLOSED],
];

/** Every item of the trust row that holds `lastItem`, in order. */
function trustRow(lastItem: string): string[] {
  const row = screen.getByText(lastItem).parentElement;
  expect(row).not.toBeNull();
  return Array.from(row?.children ?? []).map((item) => item.textContent ?? "");
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ plans: [], oneTimeProducts: [] }),
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Hero", () => {
  it.each(ALL_STATES)(
    "invites a visitor to start free in every state (%s)",
    (_state, offer) => {
      render(<Hero offer={offer} />);

      const cta = screen.getByRole("link", { name: /start your free trial/i });
      expect(cta).toHaveAttribute("href", "/signup");
    },
  );

  it.each(ALL_STATES)(
    "says only 'No credit card required.' under the buttons (%s)",
    (_state, offer) => {
      render(<Hero offer={offer} />);

      expect(screen.getByText("No credit card required.")).toBeInTheDocument();
      expect(
        screen.queryByText("14 days of Pro. No credit card required."),
      ).not.toBeInTheDocument();
    },
  );

  it("loading: the pill is an unlabelled placeholder that promises nothing", () => {
    const { container } = render(<Hero offer={LOADING} />);

    // `.glass` too: the caret in the headline is also `animate-pulse`.
    expect(
      container.querySelector('.glass.animate-pulse[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(container.querySelector('a[href="#pricing"]')).toBeNull();
    expect(heroText(container)).not.toMatch(/14 days|3 months|spot/);
  });

  it("spots left: the full and the short hook, with the count", () => {
    const { container } = render(<Hero offer={OPEN} />);

    // jsdom applies no CSS, so both the `md` and the short span are present.
    const text = pillText(container);
    expect(text).toContain(
      "First 20 users get ReCopyFast Pro free for 3 months · 17 of 20 spots left",
    );
    expect(text).toContain("Pro free for 3 months · 17 of 20 left");
  });

  it("last spot: 'Last spot left' in both forms, and no '1 of 20'", () => {
    const { container } = render(<Hero offer={LAST} />);

    expect(pillForms(container)).toEqual({
      desktop:
        "First 20 users get ReCopyFast Pro free for 3 months · Last spot left",
      phone: "Pro free for 3 months · Last spot left",
    });
    expect(pillText(container)).not.toContain("1 of 20");
  });

  it("sold out or unknown: the 14-day trial, and no number", () => {
    const { container } = render(<Hero offer={CLOSED} />);

    expect(pillForms(container)).toEqual({
      desktop: "Every new account gets 14 days of Pro, free",
      phone: "14 days of Pro, free",
    });
    expect(heroText(container)).not.toMatch(/\d+ of \d+/);
    expect(heroText(container)).not.toMatch(/3 months/);
  });

  it("the 20 is the count's limit, never a literal", () => {
    const { container } = render(
      <Hero offer={{ status: "open", remaining: 17, limit: 30 }} />,
    );

    const text = pillText(container);
    expect(text).toContain("First 30 users");
    expect(text).toContain("17 of 30 spots left");
    expect(heroText(container)).not.toContain("20");
  });
});

describe("FinalCTA", () => {
  it.each(TRUST_LEADS)("leads the trust row with %s", (lead, offer) => {
    render(<FinalCTA offer={offer} />);

    expect(trustRow("Cancel anytime")).toEqual([
      lead,
      "No credit card required",
      "Cancel anytime",
    ]);
  });

  it("marks the row in the landing's teal, not emerald", () => {
    const { container } = render(<FinalCTA offer={CLOSED} />);

    expect(container.querySelectorAll(".bg-teal-600")).toHaveLength(3);
    expect(container.querySelectorAll(".bg-emerald-500")).toHaveLength(0);
  });
});

describe("Pricing", () => {
  it.each(TRUST_LEADS)("leads the trust row with %s", async (lead, offer) => {
    render(<Pricing offer={offer} />);
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Loading pricing" }),
      ).not.toBeInTheDocument(),
    );

    expect(trustRow("Cancel anytime")).toEqual([
      lead,
      "No credit card required",
      "Cancel anytime",
    ]);
  });
});
