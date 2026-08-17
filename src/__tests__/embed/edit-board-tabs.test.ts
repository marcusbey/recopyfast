/**
 * s04 AC4 / AC5 — the Edit Board's site-wide theming is retired at the source.
 *
 * The PRD puts the site-wide theme editor in the graveyard: "We do not restyle
 * a site. The moment we edit design at that scope we inherit 'you broke my
 * site' support forever." Per-element typography and colour are explicitly NOT
 * covered by that entry and are untouched by this story — they live in
 * `src/components/editor/`, share no code with the widget, and stay shipped.
 *
 * Two things had to go, and only one of them is obvious:
 *
 *   1. The `Styles` and `Themes` entries in the Edit Board's tab bar.
 *   2. The "🎨 Apply Style" quick action rendered inside the *Elements* tab
 *      whenever elements are selected. It called `switchTab('styles')` directly
 *      and never went near the tab bar, so deleting the two tab entries alone
 *      left a fully working route to the Styles panel: select an element, click
 *      Apply Style, land on the retired tab, fire the exact
 *      `/edit-board/styles/apply` request AC5 forbids. AC4 would have read as
 *      green the whole time.
 *
 * THESE TESTS RUN THE SHIPPED WIDGET. `recopyfast.src.js` is a browser IIFE
 * that reads `document.currentScript` at parse time and cannot be imported, so
 * the relevant blocks are sliced out of the real file and evaluated with a
 * jsdom `document` injected — the same technique as
 * `src/__tests__/embed/element-id-page-scope.test.ts`. A transcription of the
 * tab list into this file would pass forever while the widget rotted.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const WIDGET_SOURCE = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);

const source = readFileSync(WIDGET_SOURCE, "utf8");

/** Slice a marked block out of the shipped widget, or say why it could not. */
function sliceBlock(begin: string, end: string): string {
  const from = source.indexOf(begin);
  const to = source.indexOf(end);

  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `public/embed/recopyfast.src.js no longer contains a "${begin}" block ` +
        `ending at "${end}", so it cannot be extracted. Update this loader ` +
        "rather than transcribing the widget into the test.",
    );
  }

  return source.slice(from, to);
}

function emptyDocument(): Document {
  return new JSDOM("<!doctype html><html><body></body></html>").window.document;
}

interface TabBarRender {
  tabs: HTMLElement;
  switched: string[];
}

/**
 * Build the Edit Board's tab bar exactly as `createPanel` does.
 *
 * `self` is the panel instance in the widget (`const self = this`); passing it
 * in shadows jsdom's global `self` and lets the test observe which tab id each
 * button asks for — the id never reaches the DOM, it only ever lives in the
 * button's own click handler.
 */
function renderTabBar(activeTab = "elements"): TabBarRender {
  const block = sliceBlock("      // Tabs\n", "      // Content area");
  const switched: string[] = [];
  const self = {
    activeTab,
    switchTab: (tabId: string) => {
      switched.push(tabId);
    },
  };

  const tabs = new Function("document", "self", `${block}\n; return tabs;`)(
    emptyDocument(),
    self,
  ) as HTMLElement;

  return { tabs, switched };
}

describe("Edit Board tab bar", () => {
  it("renders Elements, Languages and History — and nothing else", () => {
    const { tabs } = renderTabBar();
    const labels = Array.from(tabs.querySelectorAll("button")).map(
      (button) => button.textContent,
    );

    expect(labels).toEqual(["Elements", "Languages", "History"]);
  });

  it("offers no way to reach a Styles or Themes panel from the tab bar", () => {
    const { tabs, switched } = renderTabBar();

    for (const button of Array.from(tabs.querySelectorAll("button"))) {
      button.dispatchEvent(
        new (
          tabs.ownerDocument.defaultView as Window & typeof globalThis
        ).MouseEvent("click"),
      );
    }

    // GUARD: every button really did fire, so the absence below is an absence
    // of Styles/Themes rather than an absence of clicks.
    expect(switched).toHaveLength(3);
    expect(switched).toEqual(["elements", "languages", "history"]);
  });

  it("keeps marking the active tab", () => {
    // Unrelated to the removal, and the thing most likely to be broken by it:
    // the active class is computed against `self.activeTab` inside the same
    // loop the tab entries were deleted from.
    const { tabs } = renderTabBar("history");
    const active = Array.from(tabs.querySelectorAll("button")).filter(
      (button) => button.className.includes("active"),
    );

    expect(active.map((button) => button.textContent)).toEqual(["History"]);
  });
});

interface SlicedPanel {
  rcf: { elements: Map<string, unknown> };
  selectedElements: Set<string>;
  renderElementsTab(): void;
}

/**
 * Run the real `renderElementsTab` against a document of our own, with a given
 * set of elements already selected.
 *
 * The block is sliced up to the Languages tab rather than to the Styles tab on
 * purpose: the Styles section between them is what this story deletes, so an
 * end marker inside it would make the loader itself the thing that changed.
 * Wrapping in a class rather than an object literal is what lets the slice hold
 * several methods — class bodies take them without separators, exactly as the
 * widget writes them.
 */
function renderElementsTab(selectedIds: readonly string[]): HTMLElement {
  const block = sliceBlock("    // Elements Tab\n", "    // Languages Tab");
  const doc = emptyDocument();

  const content = doc.createElement("div");
  content.id = "rcf-eb-content";
  doc.body.appendChild(content);

  const Panel = new Function(
    "document",
    `return class SlicedPanel { ${block} };`,
  )(doc) as new () => SlicedPanel;

  const panel = new Panel();
  panel.rcf = {
    elements: new Map<string, unknown>([
      [
        "rcf-headline",
        {
          type: "H1",
          originalContent: "Simple pricing",
          element: doc.createElement("h1"),
        },
      ],
      [
        "rcf-lead",
        {
          type: "P",
          originalContent: "Start free, upgrade when you grow.",
          element: doc.createElement("p"),
        },
      ],
    ]),
  };
  panel.selectedElements = new Set(selectedIds);
  panel.renderElementsTab();

  return content;
}

describe("Edit Board Elements tab", () => {
  it("lists the editable elements it was given", () => {
    // GUARD. Everything below asserts an absence; if the slice stopped
    // rendering anything at all they would pass on an empty document.
    const content = renderElementsTab([]);

    expect(content.textContent).toContain("Editable Elements (2)");
    expect(content.textContent).toContain("Simple pricing");
  });

  it("still reports what is selected", () => {
    // GUARD for the test below: selecting elements really does reach the
    // sticky action area, which is where the Apply Style button used to live.
    const content = renderElementsTab(["rcf-headline", "rcf-lead"]);

    expect(content.textContent).toContain("2 element(s) selected");
  });

  it("offers no Apply Style shortcut once elements are selected", () => {
    const content = renderElementsTab(["rcf-headline", "rcf-lead"]);
    const buttonLabels = Array.from(content.querySelectorAll("button")).map(
      (button) => button.textContent ?? "",
    );

    expect(buttonLabels.some((label) => /apply style/i.test(label))).toBe(
      false,
    );
    expect(content.textContent).not.toContain("Apply Style");
  });
});

describe("the retired site-wide theming endpoints", () => {
  /**
   * The strongest form of AC5, and the one that does not depend on having
   * correctly enumerated every caller. Removing the buttons that reach a fetch
   * leaves the fetch; removing the fetch leaves nothing to reach. If a future
   * change reintroduces a caller, there is no request-issuing code for it to
   * call.
   */
  it.each([
    ["/edit-board/styles/apply"],
    ["/edit-board/themes"],
    // Not named by AC5, but the same graveyard surface: the styles list the
    // retired panel read before it could apply anything.
    ["/edit-board/styles?"],
  ])("is not requested anywhere in the widget: %s", (endpoint) => {
    expect(source).not.toContain(endpoint);
  });

  it("still ships the endpoints that are not retired", () => {
    // GUARD. `source` is the real file and the assertions above are absences,
    // so this proves the file was read and still contains widget code.
    expect(source).toContain("/edit-board/history");
    expect(source).toContain("/edit-board/languages");
  });
});
