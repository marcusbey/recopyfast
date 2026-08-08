/**
 * @jest-environment jsdom
 *
 * The toolbar has to be findable by the guard that decides what dismisses it.
 *
 * `InteractiveHero.tsx:483-491` treats a mousedown as "outside the editor"
 * unless the target sits under `[data-editable-id]`, `[data-editor-toolbar]` or
 * `[data-typography-panel]`. Two of those three selectors matched nothing in
 * the app, so pressing Save, Cancel or Typography counted as a click outside:
 * the toolbar was torn down on mousedown and the press never reached its
 * handler. In the demo now carrying the hero, that meant the save confirmation
 * never appeared and Cancel never restored the original text.
 *
 * These assertions are deliberately about the marker rather than the click.
 * The guard lives in a different component and listens on `document`, so a
 * click-level test here would exercise a copy of the logic; what actually broke
 * was the contract between the two files, and that is what is pinned.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import FloatingEditorToolbar from "../FloatingEditorToolbar";
import type { TypographyStyles } from "@/types/editor";

/** The selectors InteractiveHero's click-outside guard exempts. */
const TOOLBAR_SELECTOR = "[data-editor-toolbar]";
const TYPOGRAPHY_SELECTOR = "[data-typography-panel]";

const STYLES: TypographyStyles = {
  fontSize: "16px",
  fontWeight: "400",
  color: "#000000",
  textAlign: "left",
};

function renderToolbar() {
  return render(
    <FloatingEditorToolbar
      position={{ top: 100, left: 12, placement: "above" }}
      styles={STYLES}
      onStylesChange={jest.fn()}
      onSave={jest.fn()}
      onDelete={jest.fn()}
      isVisible
    />,
  );
}

afterEach(cleanup);

describe("FloatingEditorToolbar dismissal markers", () => {
  it("carries the marker the click-outside guard looks for", () => {
    renderToolbar();

    // Queried against the document, not the render container: the toolbar
    // portals to document.body, so the container never holds it.
    expect(document.body.querySelector(TOOLBAR_SELECTOR)).not.toBeNull();
  });

  it("puts every action inside the marked subtree", () => {
    renderToolbar();

    // Whatever the toolbar renders, a press on it must resolve to the marker —
    // that is exactly what `target.closest(...)` asks at mousedown time.
    const actions = screen.getAllByRole("button");
    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      expect(action.closest(TOOLBAR_SELECTOR)).not.toBeNull();
    }
  });

  it("marks the typography panel once it is open", () => {
    renderToolbar();

    const typographyToggle = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("title") === "Typography");
    expect(typographyToggle).toBeDefined();

    fireEvent.click(typographyToggle!);

    // Guard against a vacuous pass: the panel must actually be open.
    expect(screen.getByText(/font weight/i)).toBeInTheDocument();
    expect(document.body.querySelector(TYPOGRAPHY_SELECTOR)).not.toBeNull();
  });
});
