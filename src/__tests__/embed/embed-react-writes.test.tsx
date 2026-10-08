/**
 * AC 13 — writing copy never replaces or removes a node the host rendered.
 *
 * The incident (docs/research/s67-embed-spa-support.md, R1c/R1d/R3): the
 * embed wrote published copy with `element.textContent = content`, which
 * throws away every child node and puts one new text node in their place. A
 * React app owns those text nodes. The next time React re-rendered the
 * element structurally — a conditional text removed, an element inserted
 * before the text — it called `removeChild` / `insertBefore` against a node
 * that was no longer there, got a NotFoundError, and React 19 unmounted the
 * whole root: a blank customer page. It happened on a client-rendered page and
 * on a server-rendered one after hydration.
 *
 * Real `react-dom/client` 19.1, with the real source IIFE booted on the page
 * React rendered, and edited rows for the author-written ids.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-react";
const API = "https://app.recopyfast.test/api";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface AppProps {
  show?: boolean;
  icon?: boolean;
  title?: string;
}

function App({ show = true, icon = false, title = "Draft title" }: AppProps) {
  return (
    <main id="app">
      <h1 data-rcf-id="r-hero">Hello{show && " world"}</h1>
      <p data-rcf-id="r-lead">
        {icon && <b>!</b>}
        Lead text
      </p>
      <button data-rcf-id="r-buy" type="button">
        <svg aria-hidden="true" />
        Buy
      </button>
      <h2 data-rcf-id="r-title">{title}</h2>
      <h1 data-rcf-id="r-kicker">
        <span>x</span>
        Title
      </h1>
    </main>
  );
}

const ROWS = [
  {
    element_id: "r-hero",
    original_content: "Hello world",
    current_content: "Published hero",
  },
  {
    element_id: "r-lead",
    original_content: "Lead text",
    current_content: "Published lead",
  },
  { element_id: "r-buy", original_content: "Buy", current_content: "Buy now" },
  {
    element_id: "r-title",
    original_content: "Draft title",
    current_content: "Published title",
  },
  {
    element_id: "r-kicker",
    original_content: "xTitle",
    current_content: "Published kicker",
  },
];

interface Harness {
  root: Root;
  reactErrors: unknown[];
  hostErrors: unknown[];
  resolveContent: () => void;
}

let harness: Harness | null = null;

function installScriptTag() {
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", "site-token");
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

/**
 * The content GET answers when the test says so, so a test can change the DOM
 * after the embed scanned it and before published copy arrives.
 */
function installFetch(holdContent: boolean) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, options?: { method?: string }) => {
      const method = options?.method || "GET";
      if (url.includes(`/content/${SITE_ID}?`) && method === "GET") {
        if (holdContent) await held;
        return { ok: true, status: 200, json: async () => ROWS };
      }
      if (url.includes("/ab-tests/active/")) {
        return { ok: true, status: 200, json: async () => ({ tests: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    },
  );
  return release;
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function renderAndBoot(props: AppProps = {}, holdContent = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const reactErrors: unknown[] = [];
  const hostErrors: unknown[] = [];
  window.addEventListener("error", (event) => hostErrors.push(event.error));
  const root = createRoot(container, {
    onUncaughtError: (error) => reactErrors.push(error),
    onCaughtError: (error) => reactErrors.push(error),
    onRecoverableError: (error) => reactErrors.push(error),
  });
  await act(async () => root.render(<App {...props} />));

  const resolveContent = installFetch(holdContent);
  new Function(WIDGET_SOURCE)();
  await settle();

  harness = { root, reactErrors, hostErrors, resolveContent };
  return harness;
}

function byId(id: string): HTMLElement {
  return document.querySelector(`[data-rcf-id="${id}"]`) as HTMLElement;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
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

afterEach(async () => {
  const widget = (window as unknown as { ReCopyFast?: { destroy(): void } })
    .ReCopyFast;
  if (widget && typeof widget.destroy === "function") widget.destroy();
  if (harness) {
    const { root } = harness;
    await act(async () => root.unmount());
    harness = null;
  }
  jest.restoreAllMocks();
});

describe("published copy written into a React 19 tree", () => {
  it("R1c: React can still remove a conditional text node it rendered", async () => {
    const { root, reactErrors, hostErrors } = await renderAndBoot({
      show: true,
    });
    expect(byId("r-hero").textContent).toBe("Published hero");

    await act(async () => root.render(<App show={false} />));

    expect(reactErrors).toEqual([]);
    expect(hostErrors).toEqual([]);
    expect(document.querySelector("#app")).not.toBeNull();
    expect(byId("r-hero").textContent).toBe("Published hero");
  });

  it("R1d: React can still insert an element before the written text node", async () => {
    const { root, reactErrors, hostErrors } = await renderAndBoot({
      icon: false,
    });
    expect(byId("r-lead").textContent).toBe("Published lead");

    await act(async () => root.render(<App icon={true} />));

    expect(reactErrors).toEqual([]);
    expect(hostErrors).toEqual([]);
    expect(document.querySelector("#app")).not.toBeNull();
    expect(byId("r-lead").querySelector("b")).not.toBeNull();
  });

  it("writes into the text node React created instead of replacing it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App />));
    const reactTextNode = byId("r-hero").firstChild;
    expect(reactTextNode?.nodeType).toBe(Node.TEXT_NODE);

    installFetch(false);
    new Function(WIDGET_SOURCE)();
    await settle();
    harness = {
      root,
      reactErrors: [],
      hostErrors: [],
      resolveContent: () => {},
    };

    expect(byId("r-hero").firstChild).toBe(reactTextNode);
    expect(reactTextNode?.nodeValue).toBe("Published hero");
    expect(byId("r-hero").textContent).toBe("Published hero");
  });

  it("puts the copy in the element's own text node, not a child element's: <h1><span>x</span>Title</h1>", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App />));
    const heading = byId("r-kicker");
    const span = heading.firstChild as HTMLElement;
    const directText = heading.lastChild;
    expect(span.nodeName).toBe("SPAN");
    expect(directText?.nodeType).toBe(Node.TEXT_NODE);

    installFetch(false);
    new Function(WIDGET_SOURCE)();
    await settle();
    harness = {
      root,
      reactErrors: [],
      hostErrors: [],
      resolveContent: () => {},
    };

    // The span stays where React put it, its text blanked; the heading's own
    // text node carries the copy.
    expect(heading.firstChild).toBe(span);
    expect(heading.lastChild).toBe(directText);
    expect(directText?.nodeValue).toBe("Published kicker");
    expect(span.textContent).toBe("");
    expect(heading.textContent).toBe("Published kicker");
  });

  it("keeps an element child: <button><svg/>Buy</button> keeps its svg", async () => {
    await renderAndBoot();

    const buy = byId("r-buy");
    expect(buy.textContent).toBe("Buy now");
    expect(buy.querySelector("svg")).not.toBeNull();
  });

  it("does not touch an element whose live text already matches the published copy", async () => {
    const { root, resolveContent } = await renderAndBoot(
      { title: "Draft title" },
      true,
    );
    // The host moves on after the embed scanned and before published copy
    // arrives: it now shows exactly what was published.
    await act(async () => root.render(<App title="Published title" />));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(byId("r-title"), {
      childList: true,
      characterData: true,
      subtree: true,
    });

    resolveContent();
    await settle();
    observer.disconnect();

    expect(byId("r-title").textContent).toBe("Published title");
    expect(records.filter((record) => record.type === "characterData")).toEqual(
      [],
    );
    expect(records.filter((record) => record.type === "childList")).toEqual([]);
  });
});
