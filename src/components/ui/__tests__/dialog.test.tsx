/**
 * `DialogContent` rendered its corner close button unconditionally, with no way
 * to omit it.
 *
 * The show-once secret moment needs a dialog with no accidental-dismiss
 * affordance at all: the secret is displayed exactly once and cannot be
 * recovered, so a stray click on an X is a webhook the owner has to delete and
 * recreate. Overlay-click and Escape were already suppressible through the
 * existing props spread; the X was not.
 *
 * `showClose` defaults to true, so every existing call site renders exactly as
 * it did before.
 */

import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function renderDialog(props: { showClose?: boolean }) {
  return render(
    <Dialog open>
      <DialogContent {...props}>
        <DialogTitle>Your webhook signing secret</DialogTitle>
        <DialogDescription>Shown once.</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent", () => {
  it("renders the corner close button by default", () => {
    renderDialog({});

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("omits the corner close button when showClose is false", () => {
    renderDialog({ showClose: false });

    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it("still renders a dialog with its content when the close button is omitted", () => {
    renderDialog({ showClose: false });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Your webhook signing secret")).toBeInTheDocument();
  });
});

/**
 * s66a — the frame never scrolls; only the body does.
 *
 * `DialogContent` was `grid overflow-y-auto p-6`. A grid item keeps
 * `min-width: auto`, so one unwrapped 300-character snippet set the column to
 * 2,524 px inside a 588 px panel: the owner's site-registered screenshot, with
 * its panel-level horizontal scrollbar and a Copy button nobody could reach
 * (s66 research, fact 1). The layout itself is proved in a real browser by
 * e2e/app-layout.spec.ts; these pin the classes that carry it.
 */
describe("Dialog anatomy (s66a)", () => {
  function renderAnatomy() {
    return render(
      <Dialog open>
        <DialogContent data-testid="frame">
          <DialogHeader data-testid="header">
            <DialogTitle>Share preview link</DialogTitle>
            <DialogDescription>Create a link.</DialogDescription>
          </DialogHeader>
          <DialogBody data-testid="body">
            <p>Body</p>
          </DialogBody>
          <DialogFooter data-testid="footer">
            <button type="button">Create link</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
  }

  it("makes DialogContent a flex column frame that never scrolls", () => {
    renderAnatomy();
    const frame = screen.getByTestId("frame");
    expect(frame).toHaveClass("flex", "flex-col", "overflow-hidden");
    expect(frame.className).not.toContain("overflow-y-auto");
    expect(frame.className).not.toMatch(/(^|\s)grid(\s|$)/);
    expect(frame).toHaveClass("rounded-container", "shadow-md");
  });

  it("exports DialogBody as the one scroll region, whose children can shrink", () => {
    renderAnatomy();
    expect(screen.getByTestId("body")).toHaveClass(
      "overflow-y-auto",
      "min-h-0",
      "flex-1",
      "[&>*]:min-w-0",
    );
  });

  it("left-aligns the header at every width", () => {
    renderAnatomy();
    const header = screen.getByTestId("header");
    expect(header.className).not.toContain("text-center");
    expect(header).toHaveClass("text-left");
  });

  it("sets the title at 16px", () => {
    renderAnatomy();
    expect(screen.getByText("Share preview link")).toHaveClass("text-base");
  });

  it("divides the footer from the body with a rule", () => {
    renderAnatomy();
    expect(screen.getByTestId("footer")).toHaveClass("border-t");
  });

  it("draws the corner close button at the control radius", () => {
    renderAnatomy();
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "rounded-control",
    );
  });
});
