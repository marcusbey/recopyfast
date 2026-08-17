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
  DialogContent,
  DialogDescription,
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
