/**
 * s70a — the embed's own UI is never site copy.
 *
 * Discovery scans the whole document, so every root the embed appends to
 * `body` must be skipped by `shouldSkipElement`, or its labels are mapped,
 * stamped `data-rcf-id` and POSTed to `/api/content/<site>` as the customer's
 * authored copy. The upsert ignores duplicates, so a junk row, once written,
 * stays. Three surfaces were reported in production (owner, 2026-10-08;
 * docs/research/s70-content-changes.md fact 1):
 *
 *   - the Edit Board: the skip list named `#rcf-edit-board`, an id no element
 *     has (the panel is `#rcf-edit-board-panel`), so its tabs, buttons and the
 *     History tab's "by <editor email>" became rows — and rows are public:
 *     `GET /api/published/<site>` serves them to anyone with the site id;
 *   - the AI suggestions modal: its own overlay, no class, id or marker;
 *   - the form-field popover: `.rcf-form-popover`, which nothing skipped.
 *
 * What is driven here, and what is not (s70a review, F4). Driven: the editor
 * bar, the staging bar, the Edit Board (Elements, then History), the AI
 * suggestions modal (refused, then answered), the form-field popover, the
 * publish confirmation, the text-edit toolbar and counter, the container hint,
 * and copy inside a host's contenteditable region. Removing any one part of
 * the skip selector, or the marker on the editor bar, the toolbar, the AI
 * modal or the popover, fails a test here (each was mutated at review). Two
 * driven surfaces pass whatever the rule says: the container hint and the
 * counter are bare `div`s, and discovery's scan selector never matches a bare
 * `div`, so their text is never a candidate in the first place.
 *
 * Not driven: the hover hint, the animation badge, the field panel (a link's
 * fields), and four of the five `createOverlay` callers (showEditorCodeUI,
 * showVerificationUI, showStagingError, openImageEditor; only
 * showPublishConfirmation is). Their markers (`data-rcf-ignore`, or
 * `.rcf-overlay` from createOverlay) keep them out; no test here proves it.
 *
 * These tests boot the real source IIFE the way embed-spa.test.ts does: a
 * visitor's page, a stubbed `fetch`, the observer's debounced rescan run on
 * fake timers, then a forced trailing discovery report so nothing the rescan
 * mapped can hide behind the 10 s coalescing window.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-ui";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";
const EDITOR = "owner@example.com";
const EXPIRES_AT = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

/** The only copy on the page: the three host text elements. */
const HOST_TEXT = [
  "Simple pricing",
  "Start free, upgrade when you grow.",
  "Get started today",
];

const HOST_HTML = `
  <main id="host">
    <h1>${HOST_TEXT[0]}</h1>
    <p data-rcf-id="lead">${HOST_TEXT[1]}</p>
    <button type="button">${HOST_TEXT[2]}</button>
  </main>`;

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

interface Reply {
  status: number;
  body: unknown;
}

interface Entry {
  element: Element;
  originalContent: string;
}

interface Widget {
  elements: Map<string, Entry>;
  lastReport: number;
  editorAuth: unknown;
  stagingAccess: unknown;
  sendContentMap(): void;
  showEditorBanner(): void;
  showStagingBanner(): void;
  showAISuggestions(input: { value: string }, elementId: string): void;
  startFormEdit(element: Element): void;
  showPublishConfirmation(): Promise<void>;
  startTextEdit(element: Element): void;
  showContainerHint(element: Element): void;
  destroy(): void;
}

function widget(): Widget {
  return (window as unknown as { ReCopyFast: Widget }).ReCopyFast;
}

function response({ status, body }: Reply) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const REFUSED: Reply = { status: 500, body: {} };
const TWO_SUGGESTIONS: Reply = {
  status: 200,
  body: {
    success: true,
    suggestions: ["Start free today.", "Free to start, easy to grow."],
  },
};

function installScriptTag() {
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

function installFetch(aiReply: Reply) {
  const recorded: Recorded[] = [];
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method || "GET";
      recorded.push({ url, method, body: init?.body });

      if (url.includes("/staging/")) {
        return response({ status: 200, body: { content: [] } });
      }
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response({ status: 200, body: [] });
      }
      if (url.includes("/edit-board/history?") && method === "GET") {
        return response({
          status: 200,
          body: {
            versions: [
              {
                id: "version-1",
                version_number: 1,
                description: "Manual snapshot",
                created_at: "2026-10-08T09:00:00.000Z",
                created_by: EDITOR,
              },
            ],
          },
        });
      }
      if (url.includes("/ai/suggest")) return response(aiReply);
      return response({ status: 200, body: { success: true } });
    },
  );
  return recorded;
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Past the observer's debounced rescan (200 ms, never more than 1,000 ms). */
async function advancePastRescan() {
  await flushMicrotasks();
  for (let elapsed = 0; elapsed < 1100; elapsed += 100) {
    jest.advanceTimersByTime(100);
    await flushMicrotasks();
  }
}

/** A visitor's page, then fake timers so the rescan runs on demand. */
async function boot(aiReply: Reply = REFUSED) {
  document.body.innerHTML = HOST_HTML;
  const recorded = installFetch(aiReply);
  new Function(WIDGET_SOURCE)();
  await settle();
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  return recorded;
}

function host(): HTMLElement {
  return document.getElementById("host") as HTMLElement;
}

function hostLead(): HTMLElement {
  return document.querySelector('#host [data-rcf-id="lead"]') as HTMLElement;
}

/** Every entry of every discovery POST to `/content/<site>`. */
function reportedContents(recorded: Recorded[]): string[] {
  return recorded
    .filter(
      (request) =>
        request.method === "POST" &&
        request.url === `${API}/content/${SITE_ID}`,
    )
    .flatMap((request) =>
      Object.values(
        JSON.parse(request.body ?? "{}") as Record<string, { content: string }>,
      ).map((entry) => entry.content),
    );
}

function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  button!.click();
}

/**
 * The four assertions. The trailing report is forced (`lastReport = 0`), so
 * anything the rescan mapped is POSTed now rather than ten seconds later.
 * Failures print the offending text, which names the surface that leaked.
 */
async function expectNoEmbedUiRecorded(recorded: Recorded[]) {
  const rcf = widget();
  rcf.lastReport = 0;
  rcf.sendContentMap();
  await flushMicrotasks();

  // GUARD: discovery POSTs are captured at all — the boot report carries the
  // host's own copy — so an empty list below is not an absence of reports.
  expect(reportedContents(recorded)).toEqual(expect.arrayContaining(HOST_TEXT));

  const mappedOutsideHost = Array.from(rcf.elements.values())
    .filter((entry) => !host().contains(entry.element))
    .map((entry) => entry.originalContent);
  expect(mappedOutsideHost).toEqual([]);

  const reportedNotHostText = reportedContents(recorded).filter(
    (content) => !HOST_TEXT.includes(content),
  );
  expect(reportedNotHostText).toEqual([]);

  const stampedOutsideHost = Array.from(
    document.querySelectorAll("[data-rcf-id]"),
  )
    .filter((node) => !host().contains(node))
    .map((node) => node.textContent);
  expect(stampedOutsideHost).toEqual([]);

  // The public-snapshot leak: an editor's address must never become a row.
  for (const request of recorded.filter((r) => r.method === "POST")) {
    expect(request.body ?? "").not.toContain(`by ${EDITOR}`);
  }
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.style.paddingTop = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const key of [
    "ReCopyFast",
    "recopyfast",
    "rcf",
    "RECOPYFAST_API",
    "RECOPYFAST_WS",
  ]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
  installScriptTag();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  const current = (window as unknown as { ReCopyFast?: Widget }).ReCopyFast;
  if (current && typeof current.destroy === "function") current.destroy();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the embed never maps or reports its own UI", () => {
  it("the editor bar", async () => {
    const recorded = await boot();
    widget().editorAuth = {
      email: EDITOR,
      permissions: ["view", "edit", "publish"],
    };

    widget().showEditorBanner();
    await advancePastRescan();

    expect(document.getElementById("rcf-editor-banner")).not.toBeNull();
    await expectNoEmbedUiRecorded(recorded);
  });

  it("the staging bar and the Edit Board: Elements, then History by an editor", async () => {
    const recorded = await boot();
    widget().stagingAccess = {
      kind: "edit-session",
      verified: true,
      email: EDITOR,
      permissions: ["view", "edit", "publish"],
      expiresAt: EXPIRES_AT,
    };

    widget().showStagingBanner();
    await advancePastRescan();
    document.getElementById("rcf-edit-board-btn")!.click();
    await advancePastRescan();

    const panel = document.getElementById("rcf-edit-board-panel")!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Editable Elements");
    await expectNoEmbedUiRecorded(recorded);

    const history = Array.from(panel.querySelectorAll("button")).find(
      (tab) => tab.textContent === "History",
    );
    history!.click();
    await advancePastRescan();

    // GUARD: the editor's address is on screen, so its absence from every
    // POST below is the skip rule working, not the History tab never loading.
    expect(panel.textContent).toContain(`by ${EDITOR}`);
    await expectNoEmbedUiRecorded(recorded);
  });

  it.each([
    [
      "refused (500)",
      REFUSED,
      "Failed to generate suggestions. Please try again.",
    ],
    [
      "answered with two suggestions",
      TWO_SUGGESTIONS,
      "Free to start, easy to grow.",
    ],
  ])(
    "the AI suggestions modal, generation %s",
    async (_case, aiReply, shown) => {
      const recorded = await boot(aiReply);

      widget().showAISuggestions({ value: HOST_TEXT[1] }, "lead");
      await advancePastRescan();
      await expectNoEmbedUiRecorded(recorded);

      clickButton("Generate Suggestions");
      await advancePastRescan();

      expect(document.body.textContent).toContain(shown);
      await expectNoEmbedUiRecorded(recorded);
    },
  );

  it("the form-field popover, on an author-declared field", async () => {
    const recorded = await boot();
    const field = document.createElement("input");
    field.setAttribute("data-rcf-id", "lead");
    field.placeholder = "Your email";
    host().appendChild(field);
    await advancePastRescan();

    widget().startFormEdit(field);
    await advancePastRescan();

    expect(document.querySelector(".rcf-form-popover")).not.toBeNull();
    await expectNoEmbedUiRecorded(recorded);
  });

  it("the publish confirmation", async () => {
    const recorded = await boot();

    void widget().showPublishConfirmation();
    await advancePastRescan();

    expect(document.body.textContent).toContain("Publish Changes Live?");
    await expectNoEmbedUiRecorded(recorded);
  });

  it("the text-edit toolbar and counter", async () => {
    const recorded = await boot();

    widget().startTextEdit(hostLead());
    await advancePastRescan();

    expect(document.querySelector(".rcf-actions-inline")).not.toBeNull();
    await expectNoEmbedUiRecorded(recorded);
  });

  it("the container hint", async () => {
    const recorded = await boot();

    widget().showContainerHint(host());
    await advancePastRescan();

    expect(document.querySelector(".rcf-container-hint")).not.toBeNull();
    await expectNoEmbedUiRecorded(recorded);
  });
});

describe("the embed never maps or reports text inside an editable region", () => {
  /**
   * `[contenteditable="true"]` is the one part of the skip selector that names
   * no embed root: it covers a host's own rich-text editor, and the element the
   * embed itself is editing. Text inside one is being typed, not authored, so
   * mapping it would record a half-written draft as the page's copy.
   */
  it('host copy inside a contenteditable="true" container', async () => {
    const recorded = await boot();
    const typed = "Half-written draft in the host's own editor";
    const written = "Written by the host after load";

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const draft = document.createElement("p");
    draft.textContent = typed;
    editor.appendChild(draft);
    const control = document.createElement("p");
    control.textContent = written;
    host().append(editor, control);
    await advancePastRescan();

    const rcf = widget();
    rcf.lastReport = 0;
    rcf.sendContentMap();
    await flushMicrotasks();

    // GUARD: the rescan saw this mutation — the paragraph appended beside the
    // editor is mapped and reported — so the draft's absence is the skip.
    const mapped = Array.from(rcf.elements.values()).map(
      (entry) => entry.element,
    );
    expect(mapped).toContain(control);
    expect(reportedContents(recorded)).toContain(written);

    expect(mapped).not.toContain(draft);
    expect(draft.hasAttribute("data-rcf-id")).toBe(false);
    expect(reportedContents(recorded)).not.toContain(typed);
  });
});
