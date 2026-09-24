/**
 * A-26 widget boundary: discovery and hydration must carry link/image
 * attributes without letting a stored URL become script execution on a
 * customer's site. These tests boot the real source widget; helper copies
 * here would let the shipped IIFE drift while the tests stayed green.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-attributes";
const SITE_TOKEN = "site-token";
const API = "https://app.recopyfast.test/api";

type StoredRow = {
  element_id: string;
  current_content: string;
  metadata?: Record<string, unknown>;
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installScriptTag() {
  const script = document.createElement("script");
  script.src = `${API}/../embed/recopyfast.src.js`;
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
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function boot(
  rows: () => StoredRow[],
  recorded: Array<{ url: string; method: string; body?: string }>,
) {
  document.querySelectorAll("img").forEach((image) => {
    Object.defineProperties(image, {
      offsetWidth: { configurable: true, value: 100 },
      offsetHeight: { configurable: true, value: 100 },
    });
  });
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (input: string, options?: { method?: string; body?: string }) => {
      const method = options?.method || "GET";
      recorded.push({ url: input, method, body: options?.body });

      if (input.includes("/staging/content/") && method === "PUT") {
        const submitted = JSON.parse(options?.body || "{}");
        if (
          typeof submitted.href === "string" &&
          /^(?:javascript|data|vbscript|sms):/i.test(submitted.href)
        ) {
          return response(400, { error: "Invalid link URL." });
        }
        return response(200, { success: true });
      }
      if (input.includes(`/staging/content/${SITE_ID}`)) {
        return response(200, { content: rows() });
      }
      if (input.includes(`/content/${SITE_ID}?`) && method === "GET") {
        return response(200, rows());
      }
      if (input.endsWith(`/content/${SITE_ID}`) && method === "POST") {
        return response(200, { success: true });
      }
      if (input.includes("/staging/validate")) {
        return response(200, { valid: true, permissions: ["edit"] });
      }
      return response(200, []);
    },
  );

  new Function(WIDGET_SOURCE)();
  await settle();
}

function rowsForCurrentElements(
  attributes: Array<Record<string, unknown>>,
): StoredRow[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-rcf-id]"),
  ).map((element, index) => ({
    element_id: element.getAttribute("data-rcf-id")!,
    current_content:
      element.tagName === "IMG"
        ? element.getAttribute("src")!
        : element.textContent!,
    metadata: attributes[index],
  }));
}

describe("embed content attributes", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).recopyfast;
    delete (window as unknown as Record<string, unknown>).rcf;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hydrates every allowed href form and trims alt when text is unchanged", async () => {
    const hrefs = [
      "https://example.com/path",
      "http://example.com/path",
      "mailto:hello@example.com",
      "tel:+14165550123",
      "/account",
      "account/settings",
      "#details",
    ];
    document.body.innerHTML =
      hrefs
        .map(
          (_, index) =>
            `<a class="rcf-editable-link" href="/old-${index}">Link ${index}</a>`,
        )
        .join("") + '<img src="/hero.jpg" alt="Old alt">';

    await boot(
      () =>
        rowsForCurrentElements([
          ...hrefs.map((href) => ({ href: `  ${href}  `, alt: "ignored" })),
          { href: "", alt: "  New hero alt  " },
        ]),
      [],
    );

    const links = document.querySelectorAll("a");
    hrefs.forEach((href, index) => {
      expect(links[index].getAttribute("href")).toBe(href);
    });
    expect(document.querySelector("img")?.getAttribute("alt")).toBe(
      "New hero alt",
    );
  });

  it("ignores unsafe stored hrefs and invalid stored alt values", async () => {
    const unsafe = [
      "javascript:alert(1)",
      "data:text/html,bad",
      "vbscript:msgbox(1)",
      "ftp://example.com/file",
      "//evil.example/path",
      "https:\\evil.example/path",
      "https://example.com/\nnext",
    ];
    document.body.innerHTML =
      unsafe
        .map(
          (_, index) =>
            `<a class="rcf-editable-link" href="/safe-${index}">Link ${index}</a>`,
        )
        .join("") + '<img src="/hero.jpg" alt="Safe alt">';

    await boot(
      () =>
        rowsForCurrentElements([
          ...unsafe.map((href) => ({ href })),
          { alt: "x".repeat(2001) },
        ]),
      [],
    );

    document.querySelectorAll("a").forEach((link, index) => {
      expect(link.getAttribute("href")).toBe(`/safe-${index}`);
    });
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("Safe alt");
  });

  it("applies explicit empty href and alt clears", async () => {
    document.body.innerHTML =
      '<a class="rcf-editable-link" href="/old">Plans</a>' +
      '<img src="/hero.jpg" alt="Old alt">';

    await boot(() => rowsForCurrentElements([{ href: "" }, { alt: "" }]), []);

    expect(document.querySelector("a")?.getAttribute("href")).toBe("");
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("hydrates text and image source when legacy rows have no metadata", async () => {
    document.body.innerHTML =
      '<a class="rcf-editable-link">Plans</a>' + '<img src="/hero.jpg">';

    await boot(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-rcf-id]")).map(
          (element) => ({
            element_id: element.getAttribute("data-rcf-id")!,
            current_content:
              element.tagName === "IMG" ? "/new-hero.jpg" : "Updated plans",
          }),
        ),
      [],
    );

    expect(document.querySelector("a")?.textContent).toBe("Updated plans");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "/new-hero.jpg",
    );
    expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("img")?.hasAttribute("alt")).toBe(false);
  });

  it("reports authored href and alt as discovery extras", async () => {
    document.body.innerHTML =
      '<a class="rcf-editable-link" href="/original">Plans</a>' +
      '<img src="/hero.jpg" alt="Original hero">';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];

    await boot(() => [], recorded);

    const discovery = recorded.find(
      (request) =>
        request.url.endsWith(`/content/${SITE_ID}`) &&
        request.method === "POST",
    );
    expect(discovery).toBeDefined();
    const contentMap = JSON.parse(discovery!.body!) as Record<
      string,
      Record<string, unknown>
    >;
    const entries = Object.values(contentMap);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "a", href: "/original" }),
        expect.objectContaining({ type: "img", alt: "Original hero" }),
      ]),
    );
  });

  it("keeps absent href and alt absent in discovery", async () => {
    document.body.innerHTML =
      '<a class="rcf-editable-link">Plans</a>' + '<img src="/hero.jpg">';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];

    await boot(() => [], recorded);

    const discovery = recorded.find(
      (request) =>
        request.url.endsWith(`/content/${SITE_ID}`) &&
        request.method === "POST",
    );
    const entries = Object.values(
      JSON.parse(discovery!.body!) as Record<string, Record<string, unknown>>,
    );

    expect(entries.find((entry) => entry.type === "a")).not.toHaveProperty(
      "href",
    );
    expect(entries.find((entry) => entry.type === "img")).not.toHaveProperty(
      "alt",
    );
    expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(document.querySelector("img")?.hasAttribute("alt")).toBe(false);
  });

  it("sends the normalized page path and marks authored ids as shared", async () => {
    window.history.replaceState(null, "", "/team/%7Emarcus/index.html");
    document.body.innerHTML =
      '<h1>Computed heading</h1><p data-rcf-id="shared-footer">Shared footer</p>';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];

    await boot(() => [], recorded);

    expect(recorded.find((request) => request.method === "GET")?.url).toContain(
      "page_path=%2Fteam%2F~marcus",
    );
    const discovery = recorded.find(
      (request) =>
        request.url.endsWith(`/content/${SITE_ID}`) &&
        request.method === "POST",
    );
    const contentMap = JSON.parse(discovery!.body!) as Record<
      string,
      Record<string, unknown>
    >;
    expect(contentMap["shared-footer"].page_path).toBeNull();
    expect(
      Object.entries(contentMap).find(([id]) => id !== "shared-footer")?.[1]
        .page_path,
    ).toBe("/team/~marcus");
  });

  it("keeps realtime href and alt updates on the same client safety boundary", async () => {
    document.body.innerHTML =
      '<a class="rcf-editable-link" href="/old">Plans</a>' +
      '<img src="/hero.jpg" alt="Old alt">';
    await boot(() => [], []);
    const link = document.querySelector("a")!;
    const image = document.querySelector("img")!;
    const widget = (
      window as unknown as {
        ReCopyFast: {
          handleContentUpdate(update: Record<string, unknown>): void;
        };
      }
    ).ReCopyFast;

    widget.handleContentUpdate({
      elementId: link.getAttribute("data-rcf-id"),
      content: "Plans",
      href: "  mailto:hello@example.com  ",
    });
    widget.handleContentUpdate({
      elementId: image.getAttribute("data-rcf-id"),
      content: "/hero.jpg",
      alt: "  Hero  ",
    });
    expect(link.getAttribute("href")).toBe("mailto:hello@example.com");
    expect(image.getAttribute("alt")).toBe("Hero");

    widget.handleContentUpdate({
      elementId: link.getAttribute("data-rcf-id"),
      content: "Plans",
      href: "javascript:alert(1)",
    });
    expect(link.getAttribute("href")).toBe("mailto:hello@example.com");
  });

  it("sends and applies only normalized href and alt editor values", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_token=test_attributes",
    );
    document.body.innerHTML =
      '<a class="rcf-editable-link" href="/old">Plans</a>' +
      '<img src="/hero.jpg" alt="Old alt">';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];
    await boot(() => [], recorded);
    const widget = (
      window as unknown as {
        ReCopyFast: {
          startLinkEdit(element: Element): void;
          openImageEditor(element: Element): void;
        };
      }
    ).ReCopyFast;

    const link = document.querySelector("a")!;
    widget.startLinkEdit(link);
    const hrefInput = document.querySelector(
      ".rcf-field-panel input",
    ) as HTMLInputElement;
    hrefInput.value = "  ../account  ";
    (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
    await settle();

    const image = document.querySelector("img")!;
    widget.openImageEditor(image);
    const modalInputs = document.querySelectorAll<HTMLInputElement>(
      ".rcf-modal .rcf-modal-input",
    );
    modalInputs[1].value = "  Hero image  ";
    (
      document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement
    ).click();
    await settle();

    const puts = recorded
      .filter((request) => request.method === "PUT")
      .map((request) => JSON.parse(request.body!));
    expect(puts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "../account" }),
        expect.objectContaining({ alt: "Hero image" }),
      ]),
    );
    expect(link.getAttribute("href")).toBe("../account");
    expect(image.getAttribute("alt")).toBe("Hero image");
  });

  it("does not apply an href the server rejects", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_token=test_attributes",
    );
    document.body.innerHTML =
      '<a class="rcf-editable-link" href="/old">Plans</a>';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];
    await boot(() => [], recorded);
    const link = document.querySelector("a")!;
    const widget = (
      window as unknown as {
        ReCopyFast: { startLinkEdit(element: Element): void };
      }
    ).ReCopyFast;

    widget.startLinkEdit(link);
    const hrefInput = document.querySelector(
      ".rcf-field-panel input",
    ) as HTMLInputElement;
    hrefInput.value = "javascript:alert(1)";
    (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
    await settle();

    expect(recorded.filter((request) => request.method === "PUT")).toHaveLength(
      1,
    );
    expect(link.getAttribute("href")).toBe("/old");
    expect(window.alert).toHaveBeenCalledWith("Invalid link URL.");
  });

  it.each(["sms:+14165550123", "javascript:void(0)"])(
    "omits unchanged unsupported href %s from a text-only edit",
    async (href) => {
      window.history.replaceState(
        null,
        "",
        "/pricing?rcf_staging=1&rcf_token=test_attributes",
      );
      document.body.innerHTML = `<a class="rcf-editable-link" href="${href}">Text us</a>`;
      const recorded: Array<{ url: string; method: string; body?: string }> =
        [];
      await boot(() => [], recorded);
      const link = document.querySelector("a")!;
      const widget = (
        window as unknown as {
          ReCopyFast: { startLinkEdit(element: Element): void };
        }
      ).ReCopyFast;

      widget.startLinkEdit(link);
      link.textContent = "Message us";
      (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
      await settle();

      const save = recorded.find((request) => request.method === "PUT");
      expect(JSON.parse(save!.body!)).toEqual(
        expect.objectContaining({ content: "Message us" }),
      );
      expect(JSON.parse(save!.body!)).not.toHaveProperty("href");
      expect(link.textContent).toBe("Message us");
      expect(link.getAttribute("href")).toBe(href);
    },
  );

  it("does not synthesize alt when only an image URL changes", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?rcf_staging=1&rcf_token=test_attributes",
    );
    document.body.innerHTML = '<img src="/hero.jpg">';
    const recorded: Array<{ url: string; method: string; body?: string }> = [];
    await boot(() => [], recorded);
    const image = document.querySelector("img")!;
    const widget = (
      window as unknown as {
        ReCopyFast: { openImageEditor(element: Element): void };
      }
    ).ReCopyFast;

    widget.openImageEditor(image);
    const urlInput = document.querySelector<HTMLInputElement>(
      '.rcf-modal input[type="url"]',
    )!;
    urlInput.value = "https://cdn.example.com/new-hero.jpg";
    (
      document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement
    ).click();
    await settle();

    const save = recorded.find((request) => request.method === "PUT");
    expect(JSON.parse(save!.body!)).not.toHaveProperty("alt");
    expect(image.hasAttribute("alt")).toBe(false);
  });
});
