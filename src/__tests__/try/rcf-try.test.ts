import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { JSDOM } from "jsdom";

const SCRIPT_PATH = path.join(process.cwd(), "public", "try", "rcf-try.js");

type PreviewApi = { exit: () => void; resume: () => boolean };

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
      "#sample h1, #sample p, #sample li, #sample button, #sample img",
    )) {
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(target).toHaveAttribute("data-rcf-try-hover");
      target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    }
    const link = document.querySelector("#sample a")!;
    link.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, altKey: true }),
    );
    expect(link).toHaveAttribute("data-rcf-try-hover");
    link.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, altKey: true }),
    );
    document
      .querySelector("#outside")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(document.querySelector("#outside")).not.toHaveAttribute(
      "data-rcf-try-hover",
    );
  });

  test("requires Alt to edit every link, including CTA and content links", () => {
    document.body.innerHTML = `
      <nav><ul><li id="wordpress"><a href="#wordpress-target">WordPress</a></li></ul></nav>
      <ul class="navbar-nav"><li class="nav-item"><a class="nav-link" href="#bootstrap-target">Bootstrap</a></li></ul>
      <nav><ul><li class="mega"><a href="#mega-target">Mega</a><div class="mega-panel"><p>Panel</p></div></li></ul></nav>
      <nav><a href="#nested-target"><p id="nested-nav-label">Nested label</p></a></nav>
      <a id="hero-cta" class="button" href="#hero-target">Get started</a>
      <p id="only-paragraph-link"><a class="button" href="#paragraph-target">Book a call</a></p>
      <ul>
        <li id="nested-only-link"><span><a href="#nested-only-target">Nested only link</a></span></li>
        <li id="content-direct-link"><a href="#content-target">Content link</a></li>
      </ul>
    `;
    inject();
    const links = Array.from(document.querySelectorAll("a"));

    for (const link of links) {
      click(link);
      expect(link).not.toHaveAttribute("contenteditable");
      if (link.closest("li"))
        expect(link.closest("li")).not.toHaveAttribute("contenteditable");
    }
    click(document.querySelector(".navbar-nav li")!);
    expect(document.querySelector(".navbar-nav li")).not.toHaveAttribute(
      "contenteditable",
    );
    click(document.querySelector("#nested-nav-label")!);
    expect(document.querySelector("#nested-nav-label")).not.toHaveAttribute(
      "contenteditable",
    );
    for (const wrapper of document.querySelectorAll(
      "#only-paragraph-link, #nested-only-link",
    )) {
      click(wrapper);
      expect(wrapper).not.toHaveAttribute("contenteditable");
    }
    click(links[0], { altKey: true });
    expect(links[0]).toHaveAttribute("contenteditable", "plaintext-only");
    click(toolbarButton("Cancel")!);
    for (const selector of [
      "#hero-cta",
      "#only-paragraph-link > a.button",
      "#content-direct-link > a",
    ]) {
      const link = document.querySelector(selector)!;
      click(link, { altKey: true });
      expect(link).toHaveAttribute("contenteditable", "plaintext-only");
      click(toolbarButton("Cancel")!);
    }
  });

  test("does not edit a no-nav mega-menu item when its LI padding is clicked", () => {
    document.body.innerHTML = `
      <ul class="mega-menu">
        <li id="products"><a href="#products">Products</a><div class="panel"><p>Browse products</p></div></li>
        <li id="content-item"><span>Read </span><a href="#guide">the guide</a></li>
      </ul>
    `;
    inject();

    click(document.querySelector("#products")!);

    expect(document.querySelector("#products")).not.toHaveAttribute(
      "contenteditable",
    );
    expect(document.querySelector(".rcf-try-toolbar")).toBeNull();

    click(document.querySelector("#content-item > span")!);
    expect(document.querySelector("#content-item")).toHaveAttribute(
      "contenteditable",
      "plaintext-only",
    );
  });

  test("clears an Alt link hover when Alt is released or the window blurs", () => {
    document.body.innerHTML = `<a href="#work">Work</a>`;
    inject();
    const link = document.querySelector("a")!;

    link.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, altKey: true }),
    );
    expect(link).toHaveAttribute("data-rcf-try-hover", "true");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(link).not.toHaveAttribute("data-rcf-try-hover");

    link.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, altKey: true }),
    );
    window.dispatchEvent(new Event("blur"));
    expect(link).not.toHaveAttribute("data-rcf-try-hover");
  });

  test("keeps the direct navigation-link guard", () => {
    document.body.innerHTML = `<div role="navigation"><a href="#pricing">Pricing</a></div>`;
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

  test("preserves inline formatting while editing and after Save", () => {
    document.body.innerHTML = `<p>Make <a href="/work">every <strong>word</strong></a> count.</p>`;
    inject();
    const paragraph = document.querySelector("p")!;
    const link = paragraph.querySelector("a")!;
    const strong = paragraph.querySelector("strong")!;

    click(strong, { altKey: true });

    expect(paragraph.querySelector("a")).toBe(link);
    expect(paragraph.querySelector("strong")).toBe(strong);
    strong.firstChild!.textContent = "phrase";
    click(toolbarButton("Save")!);

    expect(paragraph.innerHTML).toBe(
      'Make <a href="/work" data-rcf-try-published="true">every <strong>phrase</strong></a> count.',
    );
  });

  test("blocks edited content and its interactive ancestor from host clicks and activation keys", () => {
    document.body.innerHTML = `<div role="button"><h2>Editable title</h2><p>Card body</p></div>`;
    const card = document.querySelector('[role="button"]')!;
    const heading = document.querySelector("h2")!;
    const cardBody = document.querySelector("p")!;
    const hostClick = jest.fn();
    const hostKey = jest.fn();
    card.addEventListener("click", hostClick);
    heading.addEventListener("keydown", hostKey);
    inject();

    click(heading);
    click(heading);
    click(cardBody);
    for (const key of [" ", "Enter"]) {
      heading.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    expect(hostClick).not.toHaveBeenCalled();
    expect(hostKey).not.toHaveBeenCalled();
    expect(heading).toHaveAttribute("contenteditable", "plaintext-only");
  });

  test("blocks a restored Bootstrap card link while its nested heading is edited", () => {
    document.body.innerHTML = `
      <a id="card" href="#card-target">
        <div class="card-body"><h3>Editable title</h3></div>
      </a>
    `;
    const card = document.querySelector("#card")!;
    const heading = document.querySelector("h3")!;
    const cardBody = document.querySelector(".card-body")!;
    const hostClick = jest.fn();
    card.addEventListener("click", hostClick);
    inject();

    click(heading, { altKey: true });
    click(cardBody);

    expect(hostClick).not.toHaveBeenCalled();
    expect(heading).toHaveAttribute("contenteditable", "plaintext-only");
  });

  test("bounds click suppression at the nearest block and never reaches a page-wide handler", () => {
    document.body.innerHTML = `
      <div id="page" onclick="void 0">
        <h2>Editable title</h2>
        <input id="outside" type="checkbox">
      </div>
    `;
    const page = document.querySelector("#page")!;
    const outside = document.querySelector("#outside")!;
    const pageClick = jest.fn();
    const outsideClick = jest.fn();
    page.addEventListener("click", pageClick);
    outside.addEventListener("click", outsideClick);
    inject();

    click(document.querySelector("h2")!);
    click(outside);

    expect(outsideClick).toHaveBeenCalledTimes(1);
    expect(pageClick).toHaveBeenCalledTimes(1);
  });

  test("uses computed layout for a custom nearest block boundary", () => {
    document.body.innerHTML = `
      <span id="custom-page" style="display:block" onclick="void 0">
        <h2>Editable title</h2>
        <input id="custom-outside" type="checkbox">
      </span>
    `;
    const wrapperClick = jest.fn();
    const outsideClick = jest.fn();
    document
      .querySelector("#custom-page")!
      .addEventListener("click", wrapperClick);
    document
      .querySelector("#custom-outside")!
      .addEventListener("click", outsideClick);
    inject();

    click(document.querySelector("h2")!);
    click(document.querySelector("#custom-outside")!);

    expect(outsideClick).toHaveBeenCalledTimes(1);
    expect(wrapperClick).toHaveBeenCalledTimes(1);
  });

  test("caps interactive ancestor suppression at four levels and excludes body", () => {
    document.body.innerHTML = `
      <span id="far-control" role="button">
        <i><b><em><small><h2>Editable title</h2></small></em></b></i>
        <span id="far-target">Far target</span>
      </span>
    `;
    const farControlClick = jest.fn();
    const bodyClick = jest.fn();
    document
      .querySelector("#far-control")!
      .addEventListener("click", farControlClick);
    document.body.addEventListener("click", bodyClick);
    inject();

    click(document.querySelector("h2")!);
    click(document.querySelector("#far-target")!);

    expect(farControlClick).toHaveBeenCalledTimes(1);
    expect(bodyClick).toHaveBeenCalledTimes(1);
  });

  test("window capture keeps a pre-existing document capture handler out of active clicks", () => {
    document.body.innerHTML = `<button type="button">Edit label</button>`;
    const documentCapture = jest.fn();
    document.addEventListener("click", documentCapture, true);
    try {
      inject();
      const button = document.querySelector("button")!;
      click(button);
      click(button);

      expect(documentCapture).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", documentCapture, true);
    }
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

  test("forces descendant paste and drop input to plain text", () => {
    document.body.innerHTML = `<p>Edit <strong>inside</strong> me</p>`;
    inject();
    const paragraph = document.querySelector("p")!;
    const descendant = document.querySelector("strong")!;
    click(descendant);
    paragraph.textContent = "";
    paragraph.appendChild(descendant);
    descendant.textContent = "";

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "<strong>Pasted</strong>" },
    });
    descendant.dispatchEvent(paste);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: () => "<em>Dropped</em>" },
    });
    descendant.dispatchEvent(drop);

    expect(paragraph.textContent).toBe(
      "<strong>Pasted</strong><em>Dropped</em>",
    );
    expect(paragraph.querySelector("strong")?.innerHTML).toBe("");
    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });

  test("keeps the root-target plain-text paste and drop guard", () => {
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

    for (const unsafe of [
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
    ]) {
      input.value = unsafe;
      click(toolbarButton("Replace image")!);
      expect(image).toHaveAttribute("src", "data:image/png;base64,AA==");
      expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
        "embedded raster data URL",
      );
    }

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

  test("replaces an image from a local raster file without a remote URL", async () => {
    document.body.innerHTML = `<img alt="Sample" src="data:image/png;base64,AA==">`;
    inject();
    const image = document.querySelector("img")!;
    click(image);
    const input = document.querySelector(
      '.rcf-try-toolbar input[type="file"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([82, 73, 70, 70])], "sample.webp", {
      type: "image/webp",
    });
    Object.defineProperty(input, "files", { value: [file] });

    const OriginalImage = window.Image;
    let resolveDecode: (() => void) | undefined;
    const decoded = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });
    class DecodableImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        this.onload?.();
        resolveDecode?.();
      }
    }
    Object.defineProperty(window, "Image", {
      configurable: true,
      value: DecodableImage,
    });

    input.dispatchEvent(new Event("change", { bubbles: true }));

    await decoded;
    expect(image.getAttribute("src")).toMatch(/^data:image\/webp;base64,/);
    expect(image).toHaveAttribute("data-rcf-try-published", "true");
    expect(document.querySelector(".rcf-try-toolbar")).toBeNull();
    Object.defineProperty(window, "Image", {
      configurable: true,
      value: OriginalImage,
    });
  });

  test("rejects oversized, empty, and corrupt local images with distinct messages", async () => {
    document.body.innerHTML = `<img alt="Sample" src="data:image/png;base64,AA==">`;
    const OriginalFileReader = window.FileReader;
    const OriginalImage = window.Image;
    const readAsDataURL = jest.fn();
    class TrackingFileReader {
      result: string | null = null;
      onerror: null | (() => void) = null;
      onload: null | (() => void) = null;

      readAsDataURL(file: File) {
        readAsDataURL(file);
        this.result = "data:image/png;base64,Y29ycnVwdA==";
        this.onload?.();
      }
    }
    class CorruptImage {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        this.onerror?.();
      }
    }
    Object.defineProperty(window, "FileReader", {
      configurable: true,
      value: TrackingFileReader,
    });
    Object.defineProperty(window, "Image", {
      configurable: true,
      value: CorruptImage,
    });

    try {
      inject();
      const image = document.querySelector("img")!;
      click(image);
      const input = document.querySelector(
        '.rcf-try-toolbar input[type="file"]',
      ) as HTMLInputElement;

      Object.defineProperty(input, "files", {
        configurable: true,
        value: [
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
            type: "",
          }),
        ],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(readAsDataURL).not.toHaveBeenCalled();
      expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
        "5 MB or smaller",
      );

      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File([], "empty.unknown", { type: "" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(readAsDataURL).not.toHaveBeenCalled();
      expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
        "empty or corrupt",
      );

      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["corrupt"], "corrupt.png", { type: "image/png" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(readAsDataURL).toHaveBeenCalledTimes(1);
      expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
        "empty or corrupt",
      );
    } finally {
      Object.defineProperty(window, "FileReader", {
        configurable: true,
        value: OriginalFileReader,
      });
      Object.defineProperty(window, "Image", {
        configurable: true,
        value: OriginalImage,
      });
    }
  });

  test("rejects a local SVG file before reading it", async () => {
    document.body.innerHTML = `<img alt="Sample" src="data:image/png;base64,AA==">`;
    inject();
    const image = document.querySelector("img")!;
    click(image);
    const input = document.querySelector(
      '.rcf-try-toolbar input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["<svg></svg>"], "sample.svg", {
      type: "image/svg+xml",
    });
    Object.defineProperty(input, "files", { value: [file] });

    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(image).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(document.querySelector(".rcf-try-error")).toHaveTextContent(
      "PNG, JPEG, GIF, WebP or AVIF",
    );
  });

  test("ignores a delayed local file read after the image edit is cancelled", () => {
    document.body.innerHTML = `
      <img id="first" alt="First" src="data:image/png;base64,AA==">
      <img id="second" alt="Second" src="data:image/png;base64,AQ==">
    `;
    const readers: Array<{
      result: string | null;
      onload: null | (() => void);
    }> = [];
    const OriginalFileReader = window.FileReader;
    class DeferredFileReader {
      result: string | null = null;
      onerror: null | (() => void) = null;
      onload: null | (() => void) = null;

      readAsDataURL() {
        readers.push(this);
      }
    }
    Object.defineProperty(window, "FileReader", {
      configurable: true,
      value: DeferredFileReader,
    });

    try {
      inject();
      click(document.querySelector("#first")!);
      const input = document.querySelector(
        '.rcf-try-toolbar input[type="file"]',
      ) as HTMLInputElement;
      Object.defineProperty(input, "files", {
        value: [new File(["png"], "first.png", { type: "image/png" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      click(toolbarButton("Cancel")!);
      click(document.querySelector("#second")!);

      readers[0].result = "data:image/png;base64,Ag==";
      readers[0].onload!();

      expect(document.querySelector("#first")).toHaveAttribute(
        "src",
        "data:image/png;base64,AA==",
      );
      expect(document.querySelector("#second")).toHaveAttribute(
        "src",
        "data:image/png;base64,AQ==",
      );
    } finally {
      Object.defineProperty(window, "FileReader", {
        configurable: true,
        value: OriginalFileReader,
      });
    }
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

  test("resume reattaches the preview controls after the host replaces body", () => {
    document.body.innerHTML = `<h1>Original page</h1>`;
    const preview = inject()!;
    const replacement = document.createElement("body");
    replacement.innerHTML = `<h1>Replacement page</h1>`;
    document.documentElement.replaceChild(replacement, document.body);

    expect(document.querySelector("#rcf-try-exit")).toBeNull();
    expect(preview.resume()).toBe(true);
    expect(document.querySelectorAll("#rcf-try-topbar")).toHaveLength(1);

    click(document.querySelector("h1")!);
    expect(document.querySelector("h1")).toHaveAttribute(
      "contenteditable",
      "plaintext-only",
    );
    click(document.querySelector("#rcf-try-exit")!);
    expect(document.querySelector("#rcf-try-topbar")).toBeNull();
  });

  test("resume removes cloned edit markers while restoring host contenteditable", () => {
    document.body.innerHTML = `<h1 contenteditable="true">Original page</h1><p>Hover me</p>`;
    const preview = inject()!;
    const heading = document.querySelector("h1")!;
    click(heading);
    document
      .querySelector("p")!
      .dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, altKey: true }),
      );
    expect(document.querySelector("p")).toHaveAttribute(
      "data-rcf-try-hover",
      "true",
    );
    const restored = document.body.cloneNode(true) as HTMLBodyElement;
    document.documentElement.replaceChild(restored, document.body);

    expect(document.querySelectorAll("#rcf-try-topbar")).toHaveLength(1);
    expect(preview.resume()).toBe(true);
    expect(document.querySelectorAll("#rcf-try-topbar")).toHaveLength(1);
    expect(document.querySelector("#rcf-try-topbar")).toBe(restored.lastChild);
    click(document.querySelector("#rcf-try-exit")!);
    expect(document.querySelector("[data-rcf-try-ui]")).toBeNull();
    expect(document.querySelector("h1")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(document.querySelector("h1")).not.toHaveAttribute(
      "data-rcf-try-editing",
    );
    expect(document.querySelector("p")).not.toHaveAttribute(
      "data-rcf-try-hover",
    );
  });

  test("Exit removes contenteditable from a restored clone of ordinary copy", () => {
    document.body.innerHTML = `<h2>Original page</h2>`;
    const preview = inject()!;
    click(document.querySelector("h2")!);
    const restored = document.body.cloneNode(true) as HTMLBodyElement;
    document.documentElement.replaceChild(restored, document.body);

    expect(preview.resume()).toBe(true);
    click(document.querySelector("#rcf-try-exit")!);

    expect(document.querySelector("h2")).not.toHaveAttribute("contenteditable");
    expect(document.querySelector("h2")).not.toHaveAttribute(
      "data-rcf-try-editing",
    );
  });

  test("leaves ordinary text Space, Enter, undo, and composition to native editing", () => {
    document.body.innerHTML = `<p>Edit me</p><button type="button">Button label</button>`;
    inject();
    const paragraph = document.querySelector("p")!;
    click(paragraph);

    for (const event of [
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
      new KeyboardEvent("keydown", {
        key: "Process",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ]) {
      paragraph.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    click(toolbarButton("Cancel")!);
    const button = document.querySelector("button")!;
    click(button);
    for (const key of [" ", "Enter"]) {
      const composing = new KeyboardEvent("keydown", {
        key,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(composing);
      expect(composing.defaultPrevented).toBe(false);
    }
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
    expect(document.querySelector("#rcf-try-topbar")).toHaveTextContent(
      "Alt+click a link to edit it",
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
