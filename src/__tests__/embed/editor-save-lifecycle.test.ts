/**
 * Inline editing lives on somebody else's page, so a duplicate request is not
 * harmless: Publish can clear staging while an older edit-session closure is
 * still able to PUT the same draft back. These tests boot the real widget and
 * control the response/timer boundary that exposed that race in CI.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  process.env.RCF_WIDGET_SOURCE ||
    path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
).replace(
  "let isSaving = false;",
  "let isSaving = false; window.__rcfIsSaving = function() { return isSaving; };",
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
  stagingAccess?: {
    email: string;
    permissions: string[];
    expiresAt: string;
  };
  showStagingBanner(): void;
  showAISuggestions(...args: unknown[]): void;
  startTextEdit(
    element: HTMLElement,
    options?: {
      fields?: Array<{
        key: string;
        label: string;
        get(element: HTMLElement): string;
        set(element: HTMLElement, value: string): void;
      }>;
      payload?(values: Record<string, string>): Record<string, string>;
    },
  ): void;
  startInlineEdit(element: HTMLElement): void;
}

interface PutResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type PutHandler = (signal?: AbortSignal) => Promise<PutResponse>;

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
      options?: { method?: string; signal?: AbortSignal },
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
        return putHandler(options.signal);
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

function typeIfEditable(content: string) {
  if (headline.getAttribute("contenteditable") === "true") {
    headline.textContent = content;
    headline.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}

function saveButton(): HTMLButtonElement {
  return document.querySelector(".rcf-btn-save") as HTMLButtonElement;
}

function cancelButton(): HTMLButtonElement {
  return document.querySelector(".rcf-btn-cancel") as HTMLButtonElement;
}

function isSaving(): boolean {
  return (
    window as unknown as { __rcfIsSaving: () => boolean }
  ).__rcfIsSaving();
}

function publishButton(): HTMLButtonElement {
  return document.querySelector(
    '#rcf-editor-banner button[aria-label="Publish"]',
  ) as HTMLButtonElement;
}

describe("inline editor save lifecycle", () => {
  beforeAll(async () => {
    jest.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
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

  it("freezes a pending save, resets in-flight state on success, and keeps a later save", async () => {
    const execCommand = jest.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    let finishPut!: (response: PutResponse) => void;
    const pendingPut = new Promise<PutResponse>((resolve) => {
      finishPut = resolve;
    });
    putHandler = () => pendingPut;

    beginEdit("One pending draft");
    jest.advanceTimersByTime(100);
    saveButton().click();
    expect(headline.getAttribute("contenteditable")).toBe("false");
    expect(isSaving()).toBe(true);
    expect(
      document.querySelector(".rcf-editor-banner-status")?.textContent,
    ).toBe("Saving…");

    typeIfEditable("One pending draft plus lost typing");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "lost paste" },
    });
    headline.dispatchEvent(paste);
    expect(execCommand).not.toHaveBeenCalled();
    headline.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(headline.getAttribute("data-rcf-editing")).toBe("true");
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
    expect(isSaving()).toBe(false);
    expect(window.alert).not.toHaveBeenCalled();
    expect(headline.hasAttribute("contenteditable")).toBe(false);
    expect(headline.textContent).toBe("One pending draft");

    beginEdit("One pending draft, then a second edit");
    saveButton().click();
    await settle();

    expect(putCount).toBe(2);
    expect(headline.textContent).toBe("One pending draft, then a second edit");
  });

  it("freezes scalar fields and AI mutation while saving, then restores them after failure", async () => {
    let failPut!: (error: Error) => void;
    putHandler = () =>
      new Promise<PutResponse>((_resolve, reject) => {
        failPut = reject;
      });
    headline.setAttribute("data-target", "first");
    instance.startTextEdit(headline, {
      fields: [
        {
          key: "target",
          label: "Target",
          get: (element) => element.getAttribute("data-target") || "",
          set: (element, value) => element.setAttribute("data-target", value),
        },
      ],
      payload: (values) => values,
    });
    headline.textContent = "Pending field draft";
    const input = document.querySelector(
      ".rcf-field-panel input",
    ) as HTMLInputElement;
    input.value = "second";

    saveButton().click();

    expect(input.readOnly).toBe(true);
    expect(
      (document.querySelector(".rcf-btn-ai") as HTMLButtonElement).disabled,
    ).toBe(true);
    (document.querySelector(".rcf-btn-ai") as HTMLButtonElement).click();
    expect(headline.textContent).toBe("Pending field draft");

    failPut(new Error("network unavailable"));
    await settle();

    expect(input.readOnly).toBe(false);
    expect(
      (document.querySelector(".rcf-btn-ai") as HTMLButtonElement).disabled,
    ).toBe(false);
    cancelButton().click();
  });

  it("times out a stalled response body and restores editing", async () => {
    putHandler = async (signal) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise<unknown>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    });

    beginEdit("Timeout draft");
    saveButton().click();
    await settle();
    jest.advanceTimersByTime(15_000);
    await settle();

    expect(window.alert).toHaveBeenCalledWith("Save timed out.");
    expect(headline.hasAttribute("contenteditable")).toBe(true);
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
    expect(headline.hasAttribute("contenteditable")).toBe(false);
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

  it("allows a legitimate later edit after a successful save", async () => {
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

  it("blocks a detached Save callback after its session closes", async () => {
    beginEdit("Discard this draft");
    const staleSave = saveButton();
    cancelButton().click();
    headline.textContent = "Changed after cleanup";

    staleSave.click();
    await settle();

    expect(putCount).toBe(0);
  });

  it("contains blank toolbar clicks without opening AI suggestions", () => {
    beginEdit("Toolbar draft");
    const aiSpy = jest.spyOn(instance, "showAISuggestions");
    const hostClick = jest.fn();
    document.body.addEventListener("click", hostClick);
    const toolbar = document.querySelector(
      ".rcf-actions-inline",
    ) as HTMLElement;
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    toolbar.dispatchEvent(click);

    expect(aiSpy).not.toHaveBeenCalled();
    expect(hostClick).toHaveBeenCalledTimes(1);
    hostClick.mockClear();

    const cancelClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    cancelButton().dispatchEvent(cancelClick);

    expect(cancelClick.defaultPrevented).toBe(true);
    expect(hostClick).not.toHaveBeenCalled();
    document.body.removeEventListener("click", hostClick);
    aiSpy.mockRestore();
  });

  it("detaches field and toolbar entry points when their session closes", async () => {
    headline.setAttribute("data-target", "first");
    instance.startTextEdit(headline, {
      fields: [
        {
          key: "target",
          label: "Target",
          get: (element) => element.getAttribute("data-target") || "",
          set: (element, value) => element.setAttribute("data-target", value),
        },
      ],
      payload: (values) => values,
    });
    const input = document.querySelector(
      ".rcf-field-panel input",
    ) as HTMLInputElement;
    const staleSave = saveButton();
    const staleCancel = cancelButton();
    const staleAi = document.querySelector(".rcf-btn-ai") as HTMLButtonElement;
    const aiSpy = jest.spyOn(instance, "showAISuggestions");

    staleCancel.click();
    headline.textContent = "Changed after cleanup";
    input.value = "second";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    staleSave.click();
    staleCancel.click();
    staleAi.click();
    await settle();

    expect(putCount).toBe(0);
    expect(headline.textContent).toBe("Changed after cleanup");
    expect(headline.getAttribute("data-target")).toBe("first");
    expect(aiSpy).not.toHaveBeenCalled();
    aiSpy.mockRestore();
  });

  it("shows the pending save state in the staging-session banner", async () => {
    document.querySelector("#rcf-editor-banner")?.remove();
    instance.stagingAccess = {
      email: "editor@example.com",
      permissions: ["edit", "publish"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    instance.showStagingBanner();
    let finishPut!: (response: PutResponse) => void;
    putHandler = () =>
      new Promise<PutResponse>((resolve) => {
        finishPut = resolve;
      });

    beginEdit("Staging banner draft");
    saveButton().click();

    expect(
      document.querySelector("#rcf-staging-banner .rcf-editor-banner-status")
        ?.textContent,
    ).toBe("Saving…");

    finishPut(ok());
    await settle();
  });
});
