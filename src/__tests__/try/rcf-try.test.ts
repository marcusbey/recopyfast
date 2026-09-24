import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { JSDOM } from "jsdom";

const SCRIPT_PATH = path.join(process.cwd(), "public", "try", "rcf-try.js");

type PreviewApi = { exit: () => void };

function inject(rootSelector?: string) {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  const script = document.createElement("script");
  if (rootSelector) script.dataset.rcfTryRoot = rootSelector;
  document.body.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
  window.eval(source);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => null,
  });
  return (window as typeof window & { __rcfTryPreview?: PreviewApi })
    .__rcfTryPreview;
}

function click(element: Element, options: MouseEventInit = {}) {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...options }),
  );
}

function toolbarButton(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined;
}

describe("standalone try-on-any-site runtime", () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    delete (window as typeof window & { __rcfTryPreview?: PreviewApi })
      .__rcfTryPreview;
  });

  afterEach(() => {
    (
      window as typeof window & { __rcfTryPreview?: PreviewApi }
    ).__rcfTryPreview?.exit();
    jest.restoreAllMocks();
  });

  test("scans supported text and image targets inside the configured root", () => {
    document.body.innerHTML = `
      <main id="sample">
        <h1>Heading</h1><p>Paragraph</p><ul><li>Item</li></ul>
        <button>Button</button><a href="/plain">Link</a><img alt="Sample" src="data:image/png;base64,AA==">
      </main>
      <h2 id="outside">Outside</h2>
    `;

    inject("#sample");

    for (const target of document.querySelectorAll(
      "#sample h1, #sample p, #sample li, #sample button, #sample a, #sample img",
    )) {
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(target).toHaveAttribute("data-rcf-try-hover");
      target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    }
    document
      .querySelector("#outside")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(document.querySelector("#outside")).not.toHaveAttribute(
      "data-rcf-try-hover",
    );
  });

  test("requires Alt to edit a navigation link", () => {
    document.body.innerHTML = `<div role="navigation"><a href="/pricing">Pricing</a></div>`;
    inject();
    const link = document.querySelector("a")!;

    click(link);
    expect(link).not.toHaveAttribute("contenteditable");
    click(link, { altKey: true });
    expect(link).toHaveAttribute("contenteditable", "plaintext-only");
  });

  test("keeps an active edit intact when its element is clicked again", () => {
    document.body.innerHTML = `<h1>Original</h1>`;
    inject();
    const heading = document.querySelector("h1")!;

    click(heading);
    heading.textContent = "Unsaved change";
    click(heading);

    expect(heading.textContent).toBe("Unsaved change");
    expect(heading).toHaveAttribute("contenteditable", "plaintext-only");
    expect(document.querySelectorAll(".rcf-try-toolbar")).toHaveLength(1);
  });

  test("edits inline, saves text as text, and publishes a local preview status", () => {
    document.body.innerHTML = `<h1>Original</h1>`;
    inject();
    const heading = document.querySelector("h1")!;

    click(heading);
    expect(heading).toHaveAttribute("contenteditable", "plaintext-only");
    heading.textContent = `<img src=x onerror="fetch('/leak')">`;
    click(toolbarButton("Save")!);

    expect(heading.textContent).toBe(`<img src=x onerror="fetch('/leak')">`);
    expect(heading.querySelector("img")).toBeNull();
    expect(heading).not.toHaveAttribute("contenteditable");
    expect(heading).toHaveAttribute("data-rcf-try-published", "true");
    expect(document.querySelector(".rcf-try-status")).toHaveTextContent(
      "Published (preview)",
    );
  });

  test("Cancel restores the original child nodes and their event handlers", () => {
    document.body.innerHTML = `<p>Before <button type="button">child</button></p>`;
    const paragraph = document.querySelector("p")!;
    const child = paragraph.querySelector("button")!;
    const handler = jest.fn();
    child.addEventListener("click", handler);
    const preview = inject();

    click(paragraph);
    paragraph.textContent = "Changed";
    click(toolbarButton("Cancel")!);

    expect(paragraph.textContent).toBe("Before child");
    expect(paragraph.querySelector("button")).toBe(child);
    preview!.exit();
    child.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("forces paste and drop input to plain text", () => {
    document.body.innerHTML = `<p>Edit me</p>`;
    inject();
    const paragraph = document.querySelector("p")!;
    click(paragraph);
    paragraph.textContent = "";

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "<strong>Pasted</strong>" },
    });
    paragraph.dispatchEvent(paste);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: () => "<em>Dropped</em>" },
    });
    paragraph.dispatchEvent(drop);

    expect(paragraph.textContent).toBe(
      "<strong>Pasted</strong><em>Dropped</em>",
    );
    expect(paragraph.children).toHaveLength(0);
    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });

  test("replaces images only with embedded raster data URLs", () => {
    document.body.innerHTML = `
      <picture>
        <source srcset="https://example.com/original-large.webp">
        <img alt="Sample" src="data:image/png;base64,AA==" srcset="https://example.com/original.png 2x">
      </picture>
    `;
    const preview = inject();
    const image = document.querySelector("img")!;
    const source = document.querySelector("source")!;
    click(image);
    const input = document.querySelector(
      ".rcf-try-toolbar input[type=url]",
    ) as HTMLInputElement;

    input.value = "https://example.com/replacement.png";
    click(toolbarButton("Replace image")!);
    expect(image).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
      "embedded raster data URL",
    );

    input.value = "data:image/webp;base64,UklGRg==";
    click(toolbarButton("Replace image")!);
    expect(image).toHaveAttribute("src", "data:image/webp;base64,UklGRg==");
    expect(image).toHaveAttribute("srcset", "");
    expect(source).toHaveAttribute("srcset", "");
    expect(image).toHaveAttribute("data-rcf-try-published", "true");

    preview!.exit();
    expect(image).toHaveAttribute("src", "data:image/webp;base64,UklGRg==");
    expect(image).toHaveAttribute("srcset", "");
    expect(source).toHaveAttribute("srcset", "");
  });

  test("image Cancel does not assign a source that was originally absent", () => {
    document.body.innerHTML = `<img alt="No source">`;
    inject();
    const image = document.querySelector("img")!;

    click(image);
    click(toolbarButton("Cancel")!);

    expect(image).not.toHaveAttribute("src");
  });

  test("does not use fetch, XMLHttpRequest, sendBeacon, or storage", () => {
    document.body.innerHTML = `<h1>Local only</h1>`;
    const fetchSpy = jest
      .spyOn(window, "fetch")
      .mockRejectedValue(new Error("network forbidden"));
    const xhrOpen = jest.spyOn(XMLHttpRequest.prototype, "open");
    const beacon = jest.fn();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: beacon,
    });
    const storageSet = jest.spyOn(Storage.prototype, "setItem");

    inject();
    click(document.querySelector("h1")!);
    document.querySelector("h1")!.textContent = "Saved locally";
    click(toolbarButton("Save")!);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  test("is idempotent and Exit restores active content and removes every owned effect", () => {
    document.body.innerHTML = `<div id="host-toolbar" class="rcf-try-toolbar">Host UI</div><h1 class="host">Original</h1>`;
    const heading = document.querySelector("h1")!;
    const first = inject();
    click(heading);
    heading.textContent = "Unsaved";

    const second = inject();
    expect(second).toBe(first);
    expect(document.querySelectorAll("#rcf-try-style")).toHaveLength(1);
    expect(document.querySelectorAll("#rcf-try-topbar")).toHaveLength(1);

    click(document.querySelector("#rcf-try-exit")!);

    expect(heading.textContent).toBe("Original");
    expect(heading).toHaveClass("host");
    expect(document.querySelector("#host-toolbar")).toHaveTextContent(
      "Host UI",
    );
    expect(
      heading
        .getAttributeNames()
        .filter((name) => name.startsWith("data-rcf-try")),
    ).toEqual([]);
    expect(document.querySelector("[data-rcf-try-ui]")).toBeNull();
    expect(
      (window as typeof window & { __rcfTryPreview?: PreviewApi })
        .__rcfTryPreview,
    ).toBeUndefined();
    click(heading);
    expect(heading).not.toHaveAttribute("contenteditable");
  });

  test("shows only one preview status after repeated saves", () => {
    document.body.innerHTML = `<h1>One</h1><p>Two</p>`;
    inject();
    for (const target of document.querySelectorAll("h1, p")) {
      click(target);
      target.textContent = `Saved ${target.tagName}`;
      click(toolbarButton("Save")!);
    }
    expect(document.querySelectorAll(".rcf-try-status")).toHaveLength(1);
  });

  test("fails closed when a configured root is missing or invalid", () => {
    document.body.innerHTML = `<h1>Marketing page</h1>`;

    expect(inject("#missing")).toBeUndefined();
    expect(document.querySelector("#rcf-try-topbar")).toBeNull();
    expect(inject("[not-valid")).toBeUndefined();
    expect(document.querySelector("h1")).not.toHaveAttribute(
      "data-rcf-try-hover",
    );
  });

  test("is a no-op in documents without an HTML head and body", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const svg = new JSDOM('<svg xmlns="http://www.w3.org/2000/svg"/>', {
      contentType: "image/svg+xml",
      runScripts: "outside-only",
    });

    expect(() => svg.window.eval(source)).not.toThrow();
    expect(
      (svg.window as unknown as { __rcfTryPreview?: PreviewApi })
        .__rcfTryPreview,
    ).toBeUndefined();
  });

  test("renders the exact disclaimer, signup destination, one style, and stays below 8 KB gzipped", () => {
    document.body.innerHTML = `<p>Preview</p>`;
    inject();

    expect(document.querySelector("#rcf-try-topbar")).toHaveTextContent(
      "ReCopyFast preview — edits stay in this tab. Nothing is saved to this site.",
    );
    expect(document.querySelector("#rcf-try-signup")).toHaveAttribute(
      "href",
      "https://www.recopyfa.st/signup?utm_source=try&utm_medium=bookmarklet",
    );
    expect(document.querySelectorAll("style#rcf-try-style")).toHaveLength(1);
    expect(
      gzipSync(readFileSync(SCRIPT_PATH), { level: 9 }).length,
    ).toBeLessThanOrEqual(8192);
  });
});
