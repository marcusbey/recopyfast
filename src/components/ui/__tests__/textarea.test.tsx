/**
 * `Textarea` — new in s66a. Input's box (design system, Controls) for
 * multi-line entry, so the next form does not hand-roll one.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("is a textarea its label resolves to, and takes typing", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" />
      </>,
    );

    const field = screen.getByLabelText("Notes");
    expect(field.tagName).toBe("TEXTAREA");
    await user.type(field, "Two\nlines");
    expect(field).toHaveValue("Two\nlines");
  });

  it("forwards its ref", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="Notes" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("draws Input's box at the control radius, and only grows vertically", () => {
    render(<Textarea aria-label="Notes" />);
    const field = screen.getByRole("textbox", { name: "Notes" });
    expect(field).toHaveClass(
      "rounded-control",
      "border-input",
      "bg-card",
      "min-h-20",
      "resize-y",
    );
    expect(field.className).not.toMatch(/rounded-(sm|md|lg|xl)/);
  });
});
