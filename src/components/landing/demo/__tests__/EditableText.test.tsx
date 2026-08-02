/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditableText from "../EditableText";
import type { EditableText as EditableTextModel } from "../types";

// `EditableText`'s edit-mode branch renders `motion.div`; framer-motion's
// animation machinery is irrelevant here and jsdom does not need it mocked
// away for correctness, but the rest of the suite follows this repo's
// convention (see `InteractiveHero.test.tsx`) of swapping it for a plain div.
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => (
      <div {...props}>{children}</div>
    ),
  },
}));

afterEach(cleanup);

/**
 * `EditableText` is presentational — `isEditing` lives in the parent
 * (`InteractiveHero`, via `handleElementActivate`). Asserting the read-mode
 * element merely *carries* `role="button"`/`tabIndex` would not prove the
 * keyboard path works, so this harness reproduces just enough of the real
 * parent's select/change wiring to drive it end to end.
 *
 * `id: "cta"` deliberately matches one of the CTA-styled text ids
 * (`elementTagFor` treats `"cta"` and `*-btn` as buttons) — this is exactly
 * the kind of element the QA register flagged as "2 demo CTAs" that must not
 * become a focusable dead end once the read-mode box is added to the tab
 * order.
 */
function Harness({
  initialText = "Reserve a table",
}: {
  initialText?: string;
}) {
  const [item, setItem] = useState<EditableTextModel>({
    id: "cta",
    text: initialText,
    isEditing: false,
    originalText: initialText,
  });

  return (
    <EditableText
      item={item}
      typographyClasses=""
      isSelected={false}
      selectedTag=""
      onSelect={() => setItem((prev) => ({ ...prev, isEditing: true }))}
      onChange={(_id, text) => setItem((prev) => ({ ...prev, text }))}
      onCommit={() => setItem((prev) => ({ ...prev, isEditing: false }))}
      onCancel={() => setItem((prev) => ({ ...prev, isEditing: false }))}
    />
  );
}

describe("EditableText read-mode keyboard accessibility", () => {
  it("is a focusable control with a name that states the affordance, not just the copy", () => {
    render(<Harness initialText="Reserve a table" />);

    const control = screen.getByRole("button", {
      name: /edit:.*reserve a table/i,
    });
    expect(control).toHaveAttribute("tabIndex", "0");
  });

  it("is reachable by Tab, and Enter opens the editor with focus moved into it", async () => {
    const user = userEvent.setup();
    render(<Harness initialText="Reserve a table" />);

    await user.tab();
    const control = screen.getByRole("button", { name: /edit:/i });
    expect(control).toHaveFocus();

    await user.keyboard("{Enter}");

    const editor = await screen.findByDisplayValue("Reserve a table");
    expect(editor).toHaveFocus();
  });

  it("also opens the editor on Space, the other button-activation key", async () => {
    const user = userEvent.setup();
    render(<Harness initialText="Reserve a table" />);

    screen.getByRole("button", { name: /edit:/i }).focus();
    await user.keyboard(" ");

    const editor = await screen.findByDisplayValue("Reserve a table");
    expect(editor).toHaveFocus();
  });

  it("still opens the editor on click — the keyboard path is additive, not a replacement", async () => {
    const user = userEvent.setup();
    render(<Harness initialText="Reserve a table" />);

    await user.click(screen.getByRole("button", { name: /edit:/i }));

    expect(
      await screen.findByDisplayValue("Reserve a table"),
    ).toBeInTheDocument();
  });
});
