import React from "react";
import { render, screen } from "@testing-library/react";
import { TrialStatusCard, type TrialCardData } from "../TrialStatusCard";

/**
 * The trial's two clocks, on the billing page.
 *
 * Time and AI credits run out independently, which is why they are two rows
 * rather than one summary: a trial with nine days left and no credits is not
 * the same situation as one with two days left and a full allowance, and a
 * single tone would have to lie about one of them.
 */

function trial(overrides: Partial<TrialCardData> = {}): TrialCardData {
  return {
    daysRemaining: 9,
    endsAt: "2026-08-30T09:00:00.000Z",
    creditsUsed: 120,
    creditsLimit: 500,
    ...overrides,
  };
}

describe("TrialStatusCard", () => {
  it("shows how long is left and what it has spent", () => {
    render(<TrialStatusCard trial={trial()} />);

    expect(screen.getByText(/9 days left in your trial/i)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(
      screen.getByText(/of 500 trial AI credits used/i),
    ).toBeInTheDocument();
  });

  it("says day, not days, on the last one", () => {
    render(<TrialStatusCard trial={trial({ daysRemaining: 1 })} />);

    expect(screen.getByText(/1 day left in your trial/i)).toBeInTheDocument();
  });

  it("warns as the time runs out", () => {
    const { container } = render(
      <TrialStatusCard trial={trial({ daysRemaining: 2 })} />,
    );

    expect(container.innerHTML).toContain("tone-warning");
  });

  it("stays informative while there is time and allowance left", () => {
    const { container } = render(<TrialStatusCard trial={trial()} />);

    expect(container.innerHTML).toContain("tone-info");
    expect(container.innerHTML).not.toContain("tone-danger");
  });

  it("warns once four fifths of the allowance is gone", () => {
    const { container } = render(
      <TrialStatusCard trial={trial({ creditsUsed: 400 })} />,
    );

    expect(container.innerHTML).toContain("tone-warning");
  });

  it("says plainly what running out of credits means", () => {
    // AC 8's "stops at zero", made visible. Naming what still works matters as
    // much as naming what does not: hand editing is unaffected.
    render(<TrialStatusCard trial={trial({ creditsUsed: 500 })} />);

    expect(
      screen.getByText(
        /AI suggestions and translations are paused until you upgrade\. Editing text by hand still works\./i,
      ),
    ).toBeInTheDocument();
  });

  it("marks an exhausted allowance as spent, not merely low", () => {
    const { container } = render(
      <TrialStatusCard trial={trial({ creditsUsed: 500 })} />,
    );

    expect(container.innerHTML).toContain("tone-danger");
  });

  it("never draws a bar past full when usage overshoots the allowance", () => {
    render(<TrialStatusCard trial={trial({ creditsUsed: 620 })} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "500");
    expect(bar).toHaveAttribute("aria-valuemax", "500");
  });

  it("holds the shape of both rows while the data is in flight", () => {
    render(<TrialStatusCard trial={null} isLoading />);

    expect(screen.getByRole("status")).toHaveAccessibleName(/trial/i);
    expect(screen.queryByText(/days left in your trial/i)).toBeNull();
  });

  it("renders nothing at all when there is no trial to report", () => {
    // Also the failure state, deliberately. This data comes from a route whose
    // own contract says it must never become load-bearing for authorisation, so
    // a failed read has to fail to *hidden* — a destructive alert about the
    // reader's own trial would state an account problem that does not exist.
    const { container } = render(<TrialStatusCard trial={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
