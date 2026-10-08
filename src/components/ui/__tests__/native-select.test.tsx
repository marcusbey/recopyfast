/**
 * `NativeSelect` — s66a, ADR 051.
 *
 * Every form select on the app surface was a raw <select> with its own class
 * string and no `appearance-none`, so the browser drew its own chevron about
 * 6 px from the border (the owner's "Expires in" screenshot). This primitive
 * keeps the native element (OS pickers on phones, `selectOptions` in tests)
 * and draws the chevron itself, 12 px inside the border.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

function renderExpiry(props: React.ComponentProps<typeof NativeSelect> = {}) {
  return render(
    <>
      <Label htmlFor="expiry">Expires in</Label>
      <NativeSelect id="expiry" defaultValue="7" {...props}>
        <option value="1">1 day</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
      </NativeSelect>
    </>,
  );
}

describe("NativeSelect", () => {
  it("is the element its <Label htmlFor> resolves to", () => {
    renderExpiry();
    const select = screen.getByLabelText("Expires in");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("7");
  });

  it("works with userEvent.selectOptions and reports the change", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderExpiry({ onChange });

    await user.selectOptions(screen.getByLabelText("Expires in"), "30");

    expect(screen.getByLabelText("Expires in")).toHaveValue("30");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("forwards its ref and aria attributes to the <select>", () => {
    const ref = React.createRef<HTMLSelectElement>();
    renderExpiry({ ref, "aria-describedby": "expiry-help", disabled: true });

    const select = screen.getByLabelText("Expires in");
    expect(ref.current).toBe(select);
    expect(select).toHaveAttribute("aria-describedby", "expiry-help");
    expect(select).toBeDisabled();
  });

  it("replaces the browser chevron and reserves room for its own", () => {
    renderExpiry();
    const select = screen.getByLabelText("Expires in");
    expect(select).toHaveClass(
      "appearance-none",
      "pr-9",
      "pl-3",
      "h-10",
      "rounded-control",
      "border-input",
      "bg-card",
    );
  });

  it("draws a decorative chevron 12px inside the right border", () => {
    renderExpiry();
    const select = screen.getByLabelText("Expires in");
    const chevron = select.parentElement?.querySelector("svg");

    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass(
      "pointer-events-none",
      "absolute",
      "right-3",
      "text-muted-foreground",
    );
  });

  it("puts layout classes on the wrapper and control classes on the select", () => {
    renderExpiry({ wrapperClassName: "mt-1", className: "text-xs" });
    const select = screen.getByLabelText("Expires in");
    expect(select.parentElement).toHaveClass("relative", "mt-1");
    expect(select).toHaveClass("text-xs");
  });
});
