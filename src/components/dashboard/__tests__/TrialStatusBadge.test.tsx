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

/**
 * s47a — the founding offer is the account's one trial row, so it rides the
 * same `trial` payload with `offerId` set. Only the label and the tooltip
 * change (docs/designs/s47a-founding-20-grant.md, screen 1); the pill, the
 * icon, the tone rule and the link are the trial's.
 */
describe("TrialStatusBadge for a founding offer account", () => {
  const ENDS_AT = "2026-12-26T15:00:00.000Z";

  function foundingOffer(daysRemaining: number): EntitlementSummary {
    return {
      ...PRO,
      trial: { daysRemaining, endsAt: ENDS_AT, offerId: "founding_20" },
    };
  }

  it("names the offer and its days left, and points at billing", async () => {
    respondWith(foundingOffer(64));

    render(<TrialStatusBadge />);

    const link = await screen.findByRole("link", {
      name: "Founding offer — 64 days left",
    });
    expect(link).toHaveAttribute("href", "/dashboard/billing");
    expect(screen.queryByText(/trial —/i)).toBeNull();
  });

  it("says what the offer gives, and never a trial, in the tooltip", async () => {
    respondWith(foundingOffer(64));

    render(<TrialStatusBadge />);

    const badge = await screen.findByTitle(
      "Your founding offer gives you Pro until Dec 26, 2026. Open billing to choose a plan.",
    );
    expect(badge.getAttribute("title")).not.toMatch(/trial|14/i);
  });

  it("says day, not days, on the last one", async () => {
    respondWith(foundingOffer(1));

    render(<TrialStatusBadge />);

    expect(
      await screen.findByRole("link", { name: "Founding offer — 1 day left" }),
    ).toBeInTheDocument();
  });

  it("stays calm at four days and warns at three", async () => {
    respondWith(foundingOffer(4));
    const { unmount } = render(<TrialStatusBadge />);
    const calm = await screen.findByText("Founding offer — 4 days left");
    expect(calm.closest("[class]")?.className).toContain("tone-info");
    unmount();

    respondWith(foundingOffer(3));
    render(<TrialStatusBadge />);
    const urgent = await screen.findByText("Founding offer — 3 days left");
    expect(urgent.closest("[class]")?.className).toContain("tone-warning");
  });

  it("sets the day count in tabular figures", async () => {
    respondWith(foundingOffer(64));

    render(<TrialStatusBadge />);

    const badge = await screen.findByText("Founding offer — 64 days left");
    expect(badge.closest("[class]")?.className).toContain("tabular");
  });
});
