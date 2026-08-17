/**
 * `Select` — the primitive `docs/design-system.md` lists among the 17 in
 * `src/components/ui/` and which did not exist. `@radix-ui/react-select` has
 * been a declared dependency the whole time, imported by zero files, so the
 * component set the design system documents and the one on disk had drifted.
 * This fills that gap rather than inventing something beside it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix's select drives a listbox with pointer capture and scroll positioning,
// neither of which jsdom implements. Without these the component throws on open.
beforeAll(() => {
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
});

function renderSelect(props: {
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  return render(
    <Select defaultValue={props.value} onValueChange={props.onValueChange}>
      <SelectTrigger aria-label="Batch window">
        <SelectValue placeholder="Choose a window" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="10">10 seconds</SelectItem>
        <SelectItem value="30">30 seconds (default)</SelectItem>
        <SelectItem value="300">5 minutes</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe("Select", () => {
  it("shows the placeholder when nothing is selected", () => {
    renderSelect({});

    expect(
      screen.getByRole("combobox", { name: "Batch window" }),
    ).toHaveTextContent("Choose a window");
  });

  it("shows the selected value", () => {
    renderSelect({ value: "30" });

    expect(
      screen.getByRole("combobox", { name: "Batch window" }),
    ).toHaveTextContent("30 seconds (default)");
  });

  it("opens and reports the option the user picks", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();
    renderSelect({ value: "30", onValueChange });

    await user.click(screen.getByRole("combobox", { name: "Batch window" }));
    await user.click(screen.getByRole("option", { name: "5 minutes" }));

    expect(onValueChange).toHaveBeenCalledWith("300");
  });
});
