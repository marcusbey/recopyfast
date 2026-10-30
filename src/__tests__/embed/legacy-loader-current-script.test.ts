import { readFileSync } from "node:fs";
import path from "node:path";

const LOADER_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast-secure.js"),
  "utf8",
);

function installLoader(attributes: Record<string, string> = {}) {
  const script = document.createElement("script");
  script.src = "https://cdn.rcf.test/embed/recopyfast-secure.js?release=one";
  for (const [name, value] of Object.entries(attributes))
    script.setAttribute(name, value);
  document.head.appendChild(script);
  jest
    .spyOn(Document.prototype, "currentScript", "get")
    .mockReturnValue(script);
  return script;
}

function installOwnCurrentScript(value: unknown) {
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => value,
  });
}

function attackerImage() {
  const image = document.createElement("img");
  image.name = "currentScript";
  image.src = "https://evil.test/attacker.js";
  image.setAttribute("data-site-id", "site-attacker");
  document.body.prepend(image);
  return image;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (document as unknown as Record<string, unknown>).currentScript;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).currentScript;
});

describe("legacy loader trusted currentScript capture (H3)", () => {
  it("loads the canonical sibling and preserves query, data, nonce, async and defer", () => {
    const loader = installLoader({
      "data-site-id": "site-genuine",
      "data-site-token": "token-genuine",
      "data-api-url": "https://api.rcf.test/api",
      nonce: "nonce-value",
      defer: "",
    });
    loader.async = true;

    new Function(LOADER_SOURCE)();

    const inserted = loader.nextElementSibling as HTMLScriptElement | null;
    expect(inserted).toBeInstanceOf(HTMLScriptElement);
    expect(inserted?.src).toBe(
      "https://cdn.rcf.test/embed/recopyfast.js?release=one",
    );
    expect(inserted?.getAttribute("data-site-id")).toBe("site-genuine");
    expect(inserted?.getAttribute("data-site-token")).toBe("token-genuine");
    expect(inserted?.getAttribute("data-api-url")).toBe(
      "https://api.rcf.test/api",
    );
    expect(inserted?.nonce).toBe("nonce-value");
    expect(inserted?.async).toBe(true);
    expect(inserted?.defer).toBe(true);
  });

  it.each([
    ["one named image", () => attackerImage()],
    ["two named images", () => [attackerImage(), attackerImage()]],
  ])(
    "ignores %s and inserts only the genuine canonical sibling",
    (_label, clobber) => {
      installLoader({ "data-site-id": "site-genuine" });
      installOwnCurrentScript(clobber());

      expect(() => new Function(LOADER_SOURCE)()).not.toThrow();

      const scripts = Array.from(document.scripts);
      expect(scripts).toHaveLength(2);
      expect(scripts[1].src).toBe(
        "https://cdn.rcf.test/embed/recopyfast.js?release=one",
      );
      expect(scripts.some((script) => script.src.includes("evil.test"))).toBe(
        false,
      );
      expect(scripts[1].getAttribute("data-site-id")).toBe("site-genuine");
    },
  );

  it.each([
    ["null", null],
    ["an image", document.createElement("img")],
    [
      "a collection",
      [document.createElement("img"), document.createElement("img")],
    ],
  ])("inserts nothing when the native getter yields %s", (_label, value) => {
    const loader = installLoader();
    installOwnCurrentScript(loader);
    jest
      .spyOn(Document.prototype, "currentScript", "get")
      .mockReturnValue(value as HTMLScriptElement | null);

    expect(() => new Function(LOADER_SOURCE)()).not.toThrow();
    expect(document.scripts).toHaveLength(1);
  });

  it("inserts nothing when the native getter throws", () => {
    const loader = installLoader();
    installOwnCurrentScript(loader);
    jest
      .spyOn(Document.prototype, "currentScript", "get")
      .mockImplementation(() => {
        throw new Error("blocked accessor");
      });

    expect(() => new Function(LOADER_SOURCE)()).not.toThrow();
    expect(document.scripts).toHaveLength(1);
  });

  it("inserts nothing when HTMLScriptElement is unavailable", () => {
    const loader = installLoader();
    installOwnCurrentScript(loader);
    const htmlScriptElement = window.HTMLScriptElement;
    delete (window as unknown as Record<string, unknown>).HTMLScriptElement;

    try {
      expect(() => new Function(LOADER_SOURCE)()).not.toThrow();
      expect(document.scripts).toHaveLength(1);
    } finally {
      (
        window as unknown as { HTMLScriptElement: typeof HTMLScriptElement }
      ).HTMLScriptElement = htmlScriptElement;
    }
  });
});
