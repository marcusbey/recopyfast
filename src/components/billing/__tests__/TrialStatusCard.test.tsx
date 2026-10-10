import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/**
 * s47a — the founding offer card (docs/designs/s47a-founding-20-grant.md,
 * screen 2). The same two rows, offer copy, and a third row of actions.
 * Every number is data: the allowance is `creditsLimit`, the date `endsAt`,
 * the pack `creditPack` — never a literal.
 */
describe("TrialStatusCard for a founding offer account", () => {
  const PACK = {
    creditsPerPack: 1000,
    maxPacksPerPurchase: 100,
    pricePerPack: 19,
  };

  function offer(overrides: Partial<TrialCardData> = {}): TrialCardData {
    return {
      daysRemaining: 64,
      endsAt: "2026-12-26T15:00:00.000Z",
      creditsUsed: 12,
      creditsLimit: 100,
      offerId: "founding_20",
      ...overrides,
    };
  }

  function renderOffer(
    overrides: Partial<TrialCardData> = {},
    onChoosePlan: () => void = jest.fn(),
  ) {
    return render(
      <TrialStatusCard
        trial={offer(overrides)}
        creditPack={PACK}
        onChoosePlan={onChoosePlan}
      />,
    );
  }

  it("says what the offer gives and how long is left", () => {
    renderOffer();

    expect(
      screen.getByText("Founding offer — 64 days left"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pro until Dec 26, 2026. Nothing is charged when it ends.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/in your trial/i)).toBeNull();
  });

  it("counts this month's AI credits against the offer's allowance", () => {
    renderOffer();

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.getByText("of 100 AI credits used this month"),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      "AI credits used this month",
    );
    expect(
      screen.getByText(
        "100 AI credits a month for all 3 months. Credits you buy are spent after these.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/trial AI credits/i)).toBeNull();
  });

  it("takes the allowance from the payload, never a literal", () => {
    renderOffer({ creditsUsed: 30, creditsLimit: 150 });

    expect(
      screen.getByText("of 150 AI credits used this month"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "150 AI credits a month for all 3 months. Credits you buy are spent after these.",
      ),
    ).toBeInTheDocument();
  });

  it("says day, not days, on the last one", () => {
    renderOffer({ daysRemaining: 1 });

    expect(screen.getByText("Founding offer — 1 day left")).toBeInTheDocument();
  });

  it("changes the time line and warns in the last three days", () => {
    const { container } = renderOffer({ daysRemaining: 3 });

    expect(
      screen.getByText("Founding offer — 3 days left"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pro until Dec 26, 2026. After that, choose a plan to keep editing. Your site keeps serving its content either way.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing is charged when it ends/i)).toBeNull();
    expect(container.innerHTML).toContain("tone-warning");
  });

  it("starts empty and calm", () => {
    const { container } = renderOffer({ creditsUsed: 0 });

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(container.innerHTML).toContain("tone-info");
    expect(container.innerHTML).not.toMatch(/tone-(warning|danger)/);
  });

  it("warns once 80 of 100 are gone, with no extra line", () => {
    const { container } = renderOffer({ creditsUsed: 84 });

    expect(container.innerHTML).toContain("tone-warning");
    expect(screen.queryByText(/are used/i)).toBeNull();
  });

  it("says what a used-up allowance means, and puts buying credits first in weight", () => {
    const { container } = renderOffer({ creditsUsed: 100 });

    expect(container.innerHTML).toContain("tone-danger");
    expect(
      screen.getByText(
        "This month's 100 AI credits are used. AI suggestions now run on credits you buy. Editing text by hand still works.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/for all 3 months/i)).toBeNull();

    const choose = screen.getByRole("button", { name: "Choose a plan" });
    const buy = screen.getByRole("button", { name: "Buy more AI credits" });
    expect(buy.className).toContain("bg-primary");
    expect(choose.className).toContain("border-input");
    // The order stays; only the weight moves.
    expect(
      choose.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps time and credits on separate tones", () => {
    const { container } = renderOffer({ daysRemaining: 64, creditsUsed: 100 });

    expect(container.innerHTML).toContain("tone-info");
    expect(container.innerHTML).toContain("tone-danger");
  });

  it("says when a plan starts billing, and what more AI costs, from the catalogue", () => {
    renderOffer();

    expect(
      screen.getByText(
        "To keep editing after Dec 26, choose a plan before then. A plan is billed from the day you choose it. Need more AI now? 1,000 credits for $19.",
      ),
    ).toBeInTheDocument();
    const choose = screen.getByRole("button", { name: "Choose a plan" });
    const buy = screen.getByRole("button", { name: "Buy more AI credits" });
    expect(choose.className).toContain("bg-primary");
    expect(buy.className).toContain("border-input");
  });

  it("opens the plans from Choose a plan", async () => {
    const user = userEvent.setup();
    const onChoosePlan = jest.fn();
    renderOffer({}, onChoosePlan);

    await user.click(screen.getByRole("button", { name: "Choose a plan" }));

    expect(onChoosePlan).toHaveBeenCalledTimes(1);
  });

  it("opens the credit purchase from Buy more AI credits", async () => {
    const user = userEvent.setup();
    renderOffer();

    await user.click(
      screen.getByRole("button", { name: "Buy more AI credits" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /purchase ai credits/i }),
    ).toBeInTheDocument();
  });

  it("keeps the plain 14-day card exactly as it was, with no action row", () => {
    render(
      <TrialStatusCard
        trial={trial()}
        creditPack={PACK}
        onChoosePlan={jest.fn()}
      />,
    );

    expect(screen.getByText(/9 days left in your trial/i)).toBeInTheDocument();
    expect(
      screen.getByText(/of 500 trial AI credits used/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/founding offer/i)).toBeNull();
  });
});
