import React from "react";
import { render, screen } from "@testing-library/react";
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
 */

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
  it("invites a visitor to start free rather than merely 'get started'", async () => {
    render(<Hero />);

    const cta = screen.getByRole("link", { name: /start your free trial/i });
    expect(cta).toHaveAttribute("href", "/signup");
  });

  it("says the trial needs no card", () => {
    render(<Hero />);

    expect(screen.getByText(/no credit card required/i)).toBeInTheDocument();
  });
});

describe("FinalCTA", () => {
  it("carries both restored trust points", () => {
    render(<FinalCTA />);

    expect(screen.getByText(/14-day free trial/i)).toBeInTheDocument();
    expect(screen.getByText(/no credit card required/i)).toBeInTheDocument();
    // The claim that was always true stays.
    expect(screen.getByText(/cancel anytime/i)).toBeInTheDocument();
  });
});

describe("Pricing", () => {
  it("lists the trial beside the guarantees it already made", async () => {
    render(<Pricing />);

    expect(await screen.findByText(/14-day free trial/i)).toBeInTheDocument();
    expect(screen.getByText(/no credit card required/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel anytime/i)).toBeInTheDocument();
    expect(
      screen.getByText(/30-day money-back guarantee/i),
    ).toBeInTheDocument();
  });
});
