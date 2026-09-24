/**
 * A terminal write refusal must end mutation without throwing away the words
 * already typed on the customer's page. The widget runs outside our app, so
 * recovery stays inline and opens first-party authentication in a separate tab.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://app.recopyfast.test";
const API = `${ORIGIN}/api`;
const GRANT = "rcfg1.the-device-grant";
const EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;

type Failure = number | "network";

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

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

function installFetch(failure: Failure, owner = false) {
  const impl = jest.fn(async (url: string, options?: { method?: string }) => {
    if (url.includes("editor/validate-grant")) {
      return response(200, {
        valid: true,
        email: "editor@example.com",
        permissions: ["view", "edit", "publish"],
        expiresAt: EXPIRES_AT,
        shouldRefresh: false,
      });
    }
    if (url.includes("staging/validate")) {
      return response(200, {
        valid: true,
        email: "owner@example.com",
        permissions: ["view", "edit", "publish"],
        expiresAt: EXPIRES_AT,
      });
    }
    if (url.includes("/staging/content/") && options?.method === "PUT") {
      if (failure === "network") throw new Error("network unavailable");
      return response(failure, {
        error: failure === 403 ? "Forbidden" : "Save failed",
      });
    }
    if (url.includes("/staging/content/"))
      return response(200, { content: [] });
    if (url.includes("/content-map")) return response(200, { success: true });
    return response(200, owner ? {} : []);
  });
  (window as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function boot(failure: Failure, owner = false) {
  if (owner) {
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_edit_token=owner-edit-token",
    );
  } else {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        grant: GRANT,
        expiresAt: EXPIRES_AT,
        email: "editor@example.com",
        permissions: ["view", "edit", "publish"],
        remembered: true,
      }),
    );
  }

  installFetch(failure, owner);
  new Function(WIDGET_SOURCE)();
  await settle();
}

async function typeAndSave() {
  const headline = document.querySelector("h1") as HTMLElement;
  headline.click();
  headline.textContent = "Typed draft survives";
  const save = document.querySelector(".rcf-btn-save") as HTMLButtonElement;
  save.click();
  await settle();
  return { headline, save };
}

describe("terminal Save recovery", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Original copy</h1><p>Another element</p>';
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(window, "alert").mockImplementation(() => {});
    jest.spyOn(window, "open").mockImplementation(() => null);
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [401, "/edit"],
    [403, "/edit"],
  ] as const)(
    "keeps a device-grant draft and opens editor re-authentication after HTTP %s",
    async (status, pathName) => {
      await boot(status);
      const { headline, save } = await typeAndSave();
      const elementId = headline.getAttribute("data-rcf-id");

      expect(window.alert).not.toHaveBeenCalled();
      expect(headline.textContent).toBe("Typed draft survives");
      expect(headline.hasAttribute("contenteditable")).toBe(false);
      expect(save.disabled).toBe(true);
      expect(
        window.sessionStorage.getItem(
          `rcf_unsaved_draft:${SITE_ID}:${elementId}`,
        ),
      ).toBe("Typed draft survives");

      const banner = document.querySelector(
        "#rcf-editor-banner",
      ) as HTMLElement;
      expect(banner.textContent).toContain("Session ended — draft kept");
      const recovery = banner.querySelectorAll(
        'button[aria-label="Re-authenticate"]',
      );
      expect(recovery).toHaveLength(1);
      const requests = (window.fetch as jest.Mock).mock.calls.length;
      headline.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
      );
      document.querySelector("p")!.click();
      const instance = (
        window as unknown as {
          ReCopyFast: {
            persistContentUpdate(id: string, content: string): Promise<unknown>;
            showPublishConfirmation(): Promise<void>;
          };
        }
      ).ReCopyFast;
      await expect(
        instance.persistContentUpdate(elementId!, "Retry"),
      ).rejects.toThrow();
      await instance.showPublishConfirmation();
      await settle();
      expect((window.fetch as jest.Mock).mock.calls).toHaveLength(requests);
      expect(document.querySelector("p")!.hasAttribute("contenteditable")).toBe(
        false,
      );
      expect(window.alert).not.toHaveBeenCalled();
      expect(headline.textContent).toBe("Typed draft survives");
      expect(
        banner.querySelectorAll("[data-rcf-terminal-status]"),
      ).toHaveLength(1);
      (recovery[0] as HTMLButtonElement).click();
      expect(window.open).toHaveBeenCalledWith(
        `${ORIGIN}${pathName}`,
        "_blank",
        "noopener",
      );
    },
  );

  it("uses the owner sites dashboard for an expired owner edit session", async () => {
    await boot(403, true);
    await typeAndSave();

    const recovery = document.querySelector(
      '#rcf-staging-banner button[aria-label="Re-authenticate"]',
    ) as HTMLButtonElement;
    recovery.click();

    expect(window.open).toHaveBeenCalledWith(
      `${ORIGIN}/dashboard/sites`,
      "_blank",
      "noopener",
    );
  });

  it("closes and locks an owner's already-open Edit Board after a terminal Save", async () => {
    await boot(401, true);
    const trigger = document.querySelector(
      "#rcf-edit-board-btn",
    ) as HTMLButtonElement;
    trigger.click();
    await settle();
    const panel = document.querySelector(
      "#rcf-edit-board-panel",
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    const controls = Array.from(panel.querySelectorAll("button"));
    await typeAndSave();
    expect(trigger.disabled).toBe(true);
    expect(panel.inert).toBe(true);
    expect(controls.every((control) => control.disabled)).toBe(true);
    const instance = (
      window as unknown as {
        ReCopyFast: {
          editBoard: { isOpen: boolean; open(): void };
        };
      }
    ).ReCopyFast;
    expect(instance.editBoard.isOpen).toBe(false);
    const calls = (window.fetch as jest.Mock).mock.calls.length;
    trigger.click();
    controls.forEach((control) => control.click());
    instance.editBoard.open();
    await settle();
    expect(instance.editBoard.isOpen).toBe(false);
    expect((window.fetch as jest.Mock).mock.calls).toHaveLength(calls);
  });

  it("keeps the latest typed draft when authentication fails after Save was sent", async () => {
    await boot(200);
    let complete!: (value: ReturnType<typeof response>) => void;
    (window.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const headline = document.querySelector("h1") as HTMLElement;
    headline.click();
    headline.textContent = "First draft";
    (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
    headline.textContent = "Latest typed draft";
    complete(response(401, { error: "Expired" }));
    await settle();
    expect(headline.textContent).toBe("Latest typed draft");
    expect(
      window.sessionStorage.getItem(
        `rcf_unsaved_draft:${SITE_ID}:${headline.getAttribute("data-rcf-id")}`,
      ),
    ).toBe("Latest typed draft");
  });

  it("restores a dismissed banner with Publish disabled when Save expires", async () => {
    await boot(401);
    (
      document.querySelector(
        '#rcf-editor-banner button[aria-label="Dismiss the ReCopyFast editor bar"]',
      ) as HTMLButtonElement
    ).click();
    await typeAndSave();
    expect(
      (
        document.querySelector(
          'button[aria-label="Publish"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(document.querySelector("[data-rcf-reauthenticate]")).not.toBeNull();
  });

  it.each([500, "network"] as const)(
    "keeps a %s failure retryable",
    async (failure) => {
      await boot(failure);
      const { headline, save } = await typeAndSave();

      expect(window.alert).toHaveBeenCalledTimes(1);
      expect(headline.getAttribute("contenteditable")).toBe("true");
      expect(save.disabled).toBe(false);
      expect(
        document.querySelector(
          '#rcf-editor-banner button[aria-label="Re-authenticate"]',
        ),
      ).toBeNull();
    },
  );

  it.each(["GET", "POST", "POST non-JSON"])(
    "locks a terminal Publish %s refusal without allowing a second attempt",
    async (method) => {
      await boot(200);
      const headline = document.querySelector("h1") as HTMLElement;
      headline.click();
      headline.textContent = "Draft before Publish";
      const rejected = response(403, { success: false });
      if (method === "POST non-JSON") {
        rejected.json = async () => {
          throw new SyntaxError("Not JSON");
        };
      }
      (window.fetch as jest.Mock).mockImplementation(async (_url, options) =>
        (options?.method || "GET") === method.split(" ")[0]
          ? rejected
          : response(200, { success: true, pendingChanges: 1 }),
      );
      const instance = (
        window as unknown as {
          ReCopyFast: {
            showPublishConfirmation(): Promise<void>;
          };
        }
      ).ReCopyFast;
      await instance.showPublishConfirmation();
      if (method.startsWith("POST")) {
        (
          document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement
        ).click();
        await settle();
      }
      const calls = (window.fetch as jest.Mock).mock.calls.length;
      await instance.showPublishConfirmation();
      expect((window.fetch as jest.Mock).mock.calls).toHaveLength(calls);
      expect(
        document.querySelector("[data-rcf-terminal-status]")?.textContent,
      ).toBe("Session ended — draft kept");
      expect(window.alert).not.toHaveBeenCalled();
      expect(
        window.sessionStorage.getItem(
          `rcf_unsaved_draft:${SITE_ID}:${headline.getAttribute("data-rcf-id")}`,
        ),
      ).toBe("Draft before Publish");
      expect(
        window.sessionStorage.getItem(`rcf_unsaved_draft:${SITE_ID}:undefined`),
      ).toBeNull();
    },
  );

  it("keeps the terminal banner when a second in-flight Save also fails", async () => {
    await boot(200);
    const complete: Array<(value: ReturnType<typeof response>) => void> = [];
    (window.fetch as jest.Mock).mockImplementation(
      () => new Promise((resolve) => complete.push(resolve)),
    );
    const instance = (
      window as unknown as {
        ReCopyFast: {
          persistContentUpdate(id: string, content: string): Promise<unknown>;
        };
      }
    ).ReCopyFast;
    const first = instance.persistContentUpdate("first", "First draft");
    const second = instance.persistContentUpdate("second", "Second draft");
    const firstRefusal = expect(first).rejects.toThrow();
    const secondRefusal = expect(second).rejects.toThrow();
    complete[0](response(401, { error: "Expired" }));
    await firstRefusal;
    expect(
      document.querySelector("[data-rcf-terminal-status]")?.textContent,
    ).toBe("Session ended — draft kept");
    complete[1](response(403, { error: "Revoked" }));
    await secondRefusal;
    expect(
      document.querySelector("[data-rcf-terminal-status]")?.textContent,
    ).toBe("Session ended — draft kept");
    expect(document.querySelectorAll("[data-rcf-reauthenticate]")).toHaveLength(
      1,
    );
  });
});

describe("inline toolbar placement below editor chrome", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Original copy</h1><p>Another element</p>';
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (
          this.id === "rcf-editor-banner" ||
          this.id === "rcf-staging-banner"
        ) {
          return {
            top: 0,
            bottom: 46,
            left: 0,
            right: 800,
            width: 800,
            height: 46,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        if (this.id === "headline") {
          return {
            top: 80,
            bottom: 120,
            left: 100,
            right: 300,
            width: 200,
            height: 40,
            x: 100,
            y: 80,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["invited editor", false, "#rcf-editor-banner"],
    ["owner edit session", true, "#rcf-staging-banner"],
  ])(
    "places the %s toolbar below its fixed banner",
    async (_, owner, banner) => {
      await boot(200, owner);
      expect(document.querySelector(banner)).not.toBeNull();

      (document.querySelector("#headline") as HTMLElement).click();

      const toolbar = document.querySelector(
        ".rcf-actions-inline",
      ) as HTMLElement;
      expect(toolbar.style.top).toBe("128px");
    },
  );
});
