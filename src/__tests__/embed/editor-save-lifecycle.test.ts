/**
 * Inline editing lives on somebody else's page, so a duplicate request is not
 * harmless: Publish can clear staging while an older edit-session closure is
 * still able to PUT the same draft back. These tests boot the real widget and
 * control the response/timer boundary that exposed that race in CI.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-save-lifecycle";
const SITE_TOKEN = "site-token";
const ORIGIN = "https://app.recopyfast.test";
const API = `${ORIGIN}/api`;
const GRANT = "rcfg1.save-lifecycle";
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;

interface WidgetInstance {
  elements: Map<string, { originalContent: string }>;
  observer?: MutationObserver;
  startInlineEdit(element: HTMLElement): void;
}

interface PutResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type PutHandler = () => Promise<PutResponse>;

const ok = (body: unknown = { success: true }): PutResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
});

let putHandler: PutHandler;
let putCount = 0;
let hasStaging = false;
let instance: WidgetInstance;
let headline: HTMLElement;
let elementId: string;

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

async function settle() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

async function boot() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      grant: GRANT,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      email: "editor@example.com",
      permissions: ["view", "edit", "publish"],
      remembered: true,
    }),
  );

  const fetchMock = jest.fn(
    async (
      url: string,
      options?: { method?: string },
    ): Promise<PutResponse> => {
      if (url.includes("editor/validate-grant")) {
        return ok({
          valid: true,
          email: "editor@example.com",
          permissions: ["view", "edit", "publish"],
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          shouldRefresh: false,
        });
      }
      if (url.includes("/staging/content/") && options?.method === "PUT") {
        putCount += 1;
        hasStaging = true;
        return putHandler();
      }
      if (url.includes("/staging/content/")) return ok({ content: [] });
      if (url.includes("/content-map")) return ok({ success: true });
      return ok([]);
    },
  );
  (window as unknown as { fetch: unknown }).fetch = fetchMock;

  new Function(WIDGET_SOURCE)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();

  instance = (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
  instance.observer?.disconnect();
  headline = document.querySelector("h1") as HTMLElement;
  elementId = headline.getAttribute("data-rcf-id")!;
}

function beginEdit(content: string) {
  instance.startInlineEdit(headline);
  headline.textContent = content;
}

function saveButton(): HTMLButtonElement {
  return document.querySelector(".rcf-btn-save") as HTMLButtonElement;
}

function cancelButton(): HTMLButtonElement {
  return document.querySelector(".rcf-btn-cancel") as HTMLButtonElement;
}

function publishButton(): HTMLButtonElement {
  return document.querySelector(
    '#rcf-editor-banner button[aria-label="Publish"]',
  ) as HTMLButtonElement;
}

describe("inline editor save lifecycle", () => {
  beforeAll(async () => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Original copy</h1><p id="outside">Outside</p>';
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    installScriptTag();
    jest.spyOn(window, "alert").mockImplementation(() => {});
    jest.spyOn(window, "confirm").mockReturnValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    putCount = 0;
    hasStaging = false;
    putHandler = async () => ok();
    headline.textContent = "Original copy";
    instance.elements.get(elementId)!.originalContent = "Original copy";
    (window.alert as jest.Mock).mockClear();
  });

  afterEach(async () => {
    const cancel = document.querySelector(
      ".rcf-btn-cancel",
    ) as HTMLButtonElement | null;
    cancel?.click();
    await settle();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("coalesces Save, Enter and an outside Publish mousedown while one PUT is pending", async () => {
    let finishPut!: (response: PutResponse) => void;
    const pendingPut = new Promise<PutResponse>((resolve) => {
      finishPut = resolve;
    });
    putHandler = () => pendingPut;

    beginEdit("One pending draft");
    jest.advanceTimersByTime(100);
    saveButton().click();
    headline.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
    );
    publishButton().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    await settle();

    const requestsWhilePending = putCount;

    finishPut(ok());
    await settle();
    expect(requestsWhilePending).toBe(1);
    expect(headline.hasAttribute("contenteditable")).toBe(false);
  });

  it("cancels outside-listener installation when save cleanup wins the 100ms race", async () => {
    beginEdit("Published draft");
    saveButton().click();
    await settle();
    expect(putCount).toBe(1);
    expect(headline.hasAttribute("contenteditable")).toBe(false);

    // This is the publish RPC's observable database effect. Any later PUT from
    // the closed edit session would restore the draft that Publish just cleared.
    hasStaging = false;
    jest.advanceTimersByTime(100);
    publishButton().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    await settle();

    expect(putCount).toBe(1);
    expect(hasStaging).toBe(false);
  });

  it("removes keyboard and paste handlers from a completed edit session", async () => {
    const execCommand = jest.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    beginEdit("Published draft");
    saveButton().click();
    await settle();
    expect(putCount).toBe(1);

    hasStaging = false;
    headline.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "stale paste" },
    });
    headline.dispatchEvent(paste);
    await settle();

    expect(putCount).toBe(1);
    expect(hasStaging).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("cancels the deferred outside listener and session-owned input handlers", async () => {
    const execCommand = jest.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    beginEdit("Discard this draft");
    cancelButton().click();
    jest.advanceTimersByTime(100);

    publishButton().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "stale paste" },
    });
    headline.dispatchEvent(paste);
    await settle();

    expect(putCount).toBe(0);
    expect(paste.defaultPrevented).toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
    expect(headline.textContent).toBe("Original copy");
  });

  it("allows a legitimate new edit after a completed session", async () => {
    beginEdit("First draft");
    saveButton().click();
    await settle();

    beginEdit("Second draft");
    saveButton().click();
    await settle();

    expect(putCount).toBe(2);
    expect(headline.textContent).toBe("Second draft");
    expect(headline.hasAttribute("contenteditable")).toBe(false);
  });

  it("unlocks the current session after a nonterminal save failure", async () => {
    putHandler = jest
      .fn<ReturnType<PutHandler>, Parameters<PutHandler>>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(ok());

    beginEdit("Retryable draft");
    saveButton().click();
    await settle();

    expect(window.alert).toHaveBeenCalledWith("network unavailable");
    expect(headline.hasAttribute("contenteditable")).toBe(true);

    saveButton().click();
    await settle();

    expect(putCount).toBe(2);
    expect(headline.textContent).toBe("Retryable draft");
    expect(headline.hasAttribute("contenteditable")).toBe(false);
  });
});
