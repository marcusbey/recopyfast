import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductTour from "../ProductTour";

describe("ProductTour", () => {
  it("presents six accessible chapters with the first screenshot selected", () => {
    render(<ProductTour />);

    const chapters = screen.getAllByRole("tab");
    expect(chapters).toHaveLength(6);
    expect(chapters[0]).toHaveAttribute("aria-selected", "true");
    expect(chapters[0]).toHaveAttribute("tabindex", "0");
    expect(chapters[1]).toHaveAttribute("aria-selected", "false");
    expect(chapters[1]).toHaveAttribute("tabindex", "-1");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("Add your website");
    expect(
      within(panel).getByRole("img", {
        name: /site registered screen.*generated installation snippet/i,
      }),
    ).toHaveAttribute("src", expect.stringContaining("01-register.webp"));
    expect(within(panel).getByText(/website you already have/i)).toBeVisible();
  });

  it("selects chapters by click and arrow key while moving focus", async () => {
    const user = userEvent.setup();
    render(<ProductTour />);

    const historyTab = screen.getByRole("tab", {
      name: /06.*see exactly what changed/i,
    });
    await user.click(historyTab);

    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
      "See exactly what changed",
    );
    expect(
      screen.getByRole("img", { name: /dated change history/i }),
    ).toHaveAttribute("src", expect.stringContaining("06-history.webp"));
    expect(
      screen.getByText(
        "Compare the original and live copy, then review the dated change history.",
      ),
    ).toBeVisible();

    await user.keyboard("{ArrowRight}");
    const firstTab = screen.getByRole("tab", {
      name: /01.*add your website/i,
    });
    expect(firstTab).toHaveFocus();
    expect(firstTab).toHaveAttribute("aria-selected", "true");
  });

  it("moves through chapters with previous and next controls and guards boundaries", async () => {
    const user = userEvent.setup();
    render(<ProductTour />);

    const previous = screen.getByRole("button", { name: "Previous chapter" });
    const next = screen.getByRole("button", { name: "Next chapter" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    await user.click(next);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Install once");
    expect(previous).toBeEnabled();

    await user.click(
      screen.getByRole("tab", { name: /06.*see exactly what changed/i }),
    );
    expect(next).toBeDisabled();
  });

  it("keeps the caption and navigation usable when a screenshot cannot load", async () => {
    const user = userEvent.setup();
    render(<ProductTour />);

    fireEvent.error(
      screen.getByRole("img", {
        name: /site registered screen.*generated installation snippet/i,
      }),
    );

    expect(
      screen.getByRole("status", { name: "Screenshot unavailable" }),
    ).toHaveTextContent(/could not load/i);
    expect(screen.getByText(/register the site/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "View full screenshot" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Install once");
    expect(
      screen.getByRole("img", { name: /installation instructions/i }),
    ).toBeVisible();
  });

  it("opens the selected screenshot in a labelled full-image dialog", async () => {
    const user = userEvent.setup();
    render(<ProductTour />);

    await user.click(
      screen.getByRole("tab", { name: /04.*publish and revisit/i }),
    );
    await user.click(
      screen.getByRole("button", { name: "View full screenshot" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Publish and revisit — full screenshot",
    });
    expect(
      within(dialog).getByText("Scroll to inspect the full-size screen."),
    ).toBeInTheDocument();
    const fullImage = within(dialog).getByRole("img", {
      name: /published opening hours visible on the example website/i,
    });
    expect(fullImage).toHaveAttribute(
      "sizes",
      "(max-width: 1024px) 1440px, calc(100vw - 64px)",
    );
    expect(fullImage).toHaveAttribute(
      "src",
      expect.stringContaining("04-publish.webp"),
    );
  });
});
