import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { TrialStatusBadge } from "../TrialStatusBadge";
import type { EntitlementSummary } from "@/types/billing";

/**
 * The one thing the dashboard overview says about a trial.
 *
 * It reads `/api/billing/entitlement`, which is presentation-only by contract —
 * so the badge is allowed to be absent, and being absent is the correct answer
 * to every kind of doubt. Nothing here decides what the account may do.
 */

function respondWith(summary: EntitlementSummary) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => summary,
  });
}

const PRO: EntitlementSummary = {
  kind: "plan",
  planId: "pro",
  planName: "Pro",
};

function trialing(daysRemaining: number): EntitlementSummary {
  return {
    ...PRO,
    trial: {
      daysRemaining,
      endsAt: new Date(
        Date.now() + daysRemaining * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TrialStatusBadge", () => {
  it("counts the days left and points at billing", async () => {
    respondWith(trialing(9));

    render(<TrialStatusBadge />);

    const link = await screen.findByRole("link", {
      name: /trial — 9 days left/i,
    });
    expect(link).toHaveAttribute("href", "/dashboard/billing");
  });

  it("says day, not days, on the last one", async () => {
    respondWith(trialing(1));

    render(<TrialStatusBadge />);

    expect(
      await screen.findByRole("link", { name: /trial — 1 day left/i }),
    ).toBeInTheDocument();
  });

  it("stays calm while there is still time", async () => {
    respondWith(trialing(4));

    render(<TrialStatusBadge />);

    const badge = await screen.findByText(/trial — 4 days left/i);

    // Tone is carried by the Badge variant; `info` is the neutral-informative
    // treatment and `warning` is the one that asks for attention.
    expect(badge.closest("[class]")?.className).toContain("tone-info");
  });

  it("switches to a warning at three days", async () => {
    respondWith(trialing(3));

    render(<TrialStatusBadge />);

    const badge = await screen.findByText(/trial — 3 days left/i);

    expect(badge.closest("[class]")?.className).toContain("tone-warning");
  });

  it("shows nothing for an account that is not trialling", async () => {
    respondWith(PRO);

    const { container } = render(<TrialStatusBadge />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the entitlement read fails", async () => {
    // Failing to a badge that says something wrong about someone's account is
    // worse than saying nothing. Middleware and the gates still decide access.
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));

    const { container } = render(<TrialStatusBadge />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the route answers an error status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server_error" }),
    });

    const { container } = render(<TrialStatusBadge />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
