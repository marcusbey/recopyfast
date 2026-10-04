import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { buildStableEmbedInstallation } from "@/lib/sites/embed-script";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.js"),
  "utf8",
);
const SITE_ID = "site-stable-copy";
const SITE_TOKEN = "site-token-stable-copy";
const API_ORIGIN = "https://api.example";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

async function until(check: () => boolean, timeoutMs = 300): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for stable-copy runtime state");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface StartupState {
  status: string;
  code: string | null;
}

interface WidgetInstance {
  handleContentUpdate(data: { elementId: string; content: string }): void;
}

function startup(window: JSDOM["window"]): StartupState {
  return (window as unknown as { __rcfStartup: StartupState }).__rcfStartup;
}

function widget(window: JSDOM["window"]): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

function createPage(options: {
  body?: string;
  includeBootstrap?: boolean;
  fonts?: { status: string; ready: Promise<unknown> };
  fetch: jest.Mock;
  runtimeProtocol?: string;
}) {
  const installation = buildStableEmbedInstallation({
    siteId: SITE_ID,
    siteToken: SITE_TOKEN,
    appUrl: API_ORIGIN,
  });
  const runtimeTag =
    options.runtimeProtocol === undefined
      ? installation.runtimeTag
      : installation.runtimeTag.replace(
          'data-rcf-startup="2"',
          `data-rcf-startup="${options.runtimeProtocol}"`,
        );
  const html = `<!doctype html><html><head>${
    options.includeBootstrap === false ? "" : installation.headBootstrap
  }</head><body>${options.body ?? '<h1 id="headline">Authored headline</h1>'}${
    runtimeTag
  }</body></html>`;
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://customer.example/pricing/index.html?rcf_token=private#hero",
    beforeParse(window) {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: options.fetch,
      });
      if (options.fonts) {
        Object.defineProperty(window.document, "fonts", {
          configurable: true,
          value: options.fonts,
        });
      }
    },
  });
  const runtime = dom.window.document.querySelector<HTMLScriptElement>(
    'script[src$="/embed/recopyfast.js"]',
  )!;
  Object.defineProperty(dom.window.document, "currentScript", {
    configurable: true,
    get: () => runtime,
  });

  return { dom, installation };
}

describe("stable-copy runtime handoff", () => {
  const openPages: JSDOM[] = [];

  afterEach(() => {
    for (const page of openPages) page.window.close();
    openPages.length = 0;
  });

  it("uses the early public read once and delivers text without waiting for fonts", async () => {
    const rows =
      deferred<Array<{ element_id: string; current_content: string }>>();
    const never = new Promise(() => {});
    const fetch = jest.fn((url: string, init?: { method?: string }) => {
      if (url.includes(`/content/${SITE_ID}?`) && !init?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => rows.promise,
        });
      }
      return Promise.resolve(response([]));
    });
    const { dom } = createPage({
      fetch,
      fonts: { status: "loading", ready: never },
    });
    openPages.push(dom);

    dom.window.eval(WIDGET_SOURCE);
    const headline =
      dom.window.document.querySelector<HTMLElement>("#headline")!;
    await until(() => headline.hasAttribute("data-rcf-id"));
    rows.resolve([
      {
        element_id: headline.getAttribute("data-rcf-id")!,
        current_content: "Published headline",
      },
    ]);
    await until(() => headline.textContent === "Published headline");

    expect(startup(dom.window).status).toBe("d");
    expect(headline).not.toHaveAttribute("data-rcf-startup-held");
    expect(
      fetch.mock.calls.filter(([url]) =>
        String(url).includes(`/api/content/${SITE_ID}?`),
      ),
    ).toHaveLength(1);
  });

  it("reveals the published baseline and assigned A/B copy in one commit", async () => {
    const rows =
      deferred<Array<{ element_id: string; current_content: string }>>();
    let targetId = "";
    const fetch = jest.fn((url: string, init?: { method?: string }) => {
      if (url.includes(`/content/${SITE_ID}?`) && !init?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => rows.promise,
        });
      }
      if (url.includes(`/ab-tests/active/${SITE_ID}`)) {
        return Promise.resolve(
          response({
            tests: [
              {
                id: "test-1",
                target_element_id: targetId,
                variants: [
                  {
                    id: "variant-1",
                    variant_content: "Assigned headline",
                    traffic_percentage: 100,
                    is_control: false,
                  },
                ],
              },
            ],
          }),
        );
      }
      if (url.includes(`/ab-tests/bucket/${SITE_ID}`)) {
        return Promise.resolve(
          response({ assignments: { "test-1": "variant-1" }, geo: null }),
        );
      }
      return Promise.resolve(response([]));
    });
    const { dom } = createPage({
      body: '<h1 id="headline">Authored headline</h1><p id="summary">Authored summary</p>',
      fetch,
    });
    openPages.push(dom);
    dom.window.eval(WIDGET_SOURCE);

    const headline =
      dom.window.document.querySelector<HTMLElement>("#headline")!;
    const summary = dom.window.document.querySelector<HTMLElement>("#summary")!;
    await until(
      () =>
        headline.hasAttribute("data-rcf-id") &&
        summary.hasAttribute("data-rcf-id"),
    );
    targetId = headline.getAttribute("data-rcf-id")!;

    const firstReveal = deferred<{ headline: string; summary: string }>();
    const observer = new dom.window.MutationObserver(() => {
      if (!headline.hasAttribute("data-rcf-startup-held")) {
        firstReveal.resolve({
          headline: headline.textContent || "",
          summary: summary.textContent || "",
        });
      }
    });
    observer.observe(dom.window.document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-rcf-startup-held"],
    });

    rows.resolve([
      { element_id: targetId, current_content: "Published headline" },
      {
        element_id: summary.getAttribute("data-rcf-id")!,
        current_content: "Published summary",
      },
    ]);

    await expect(firstReveal.promise).resolves.toEqual({
      headline: "Assigned headline",
      summary: "Published summary",
    });
    observer.disconnect();
    expect(startup(dom.window).status).toBe("d");
    expect(headline).toHaveAttribute("data-rcf-test", "test-1");
    expect(headline).toHaveAttribute("data-rcf-variant", "variant-1");
  });

  it("keeps authored copy when a v2 runtime tag has no matching head bootstrap", async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        response([
          { element_id: "any", current_content: "Late published headline" },
        ]),
      );
    const { dom } = createPage({ includeBootstrap: false, fetch });
    openPages.push(dom);

    dom.window.eval(WIDGET_SOURCE);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(dom.window.document.querySelector("#headline")?.textContent).toBe(
      "Authored headline",
    );
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).includes(`/content/${SITE_ID}?`),
      ),
    ).toBe(false);
    const instance = widget(dom.window);
    const elementId = dom.window.document
      .querySelector("#headline")
      ?.getAttribute("data-rcf-id");
    expect(elementId).toBeTruthy();
    instance.handleContentUpdate({
      elementId: elementId!,
      content: "Automatic late replacement",
    });
    expect(dom.window.document.querySelector("#headline")?.textContent).toBe(
      "Authored headline",
    );

    (
      dom.window as unknown as {
        recopyfast: { update(elementId: string, content: string): void };
      }
    ).recopyfast.update(elementId!, "Explicit replacement");
    expect(dom.window.document.querySelector("#headline")?.textContent).toBe(
      "Explicit replacement",
    );
  });

  it.each(["3", ""])(
    "fails closed for an explicitly marked unsupported protocol %p",
    async (runtimeProtocol) => {
      const rows =
        deferred<Array<{ element_id: string; current_content: string }>>();
      const fetch = jest.fn((url: string, init?: { method?: string }) => {
        if (url.includes(`/content/${SITE_ID}?`) && !init?.method) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => rows.promise,
          });
        }
        return Promise.resolve(response([]));
      });
      const { dom } = createPage({ fetch, runtimeProtocol });
      openPages.push(dom);
      dom.window.eval(WIDGET_SOURCE);

      const headline =
        dom.window.document.querySelector<HTMLElement>("#headline")!;
      await until(() => startup(dom.window).status === "f");
      rows.resolve([
        {
          element_id: headline.getAttribute("data-rcf-id") || "not-scanned",
          current_content: "Late published headline",
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(headline.textContent).toBe("Authored headline");
      expect(
        fetch.mock.calls.filter(([url]) =>
          String(url).includes(`/content/${SITE_ID}?`),
        ),
      ).toHaveLength(1);
    },
  );

  it("reveals a valid published baseline before the cap when A/B hangs, without a late variant or impression", async () => {
    const rows =
      deferred<Array<{ element_id: string; current_content: string }>>();
    const bucket = deferred<ReturnType<typeof response>>();
    let targetId = "";
    const fetch = jest.fn((url: string, init?: { method?: string }) => {
      if (url.includes(`/content/${SITE_ID}?`) && !init?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => rows.promise,
        });
      }
      if (url.includes(`/ab-tests/active/${SITE_ID}`)) {
        return Promise.resolve(
          response({
            tests: [
              {
                id: "test-slow",
                target_element_id: targetId,
                variants: [
                  {
                    id: "variant-slow",
                    variant_content: "Late assigned headline",
                    traffic_percentage: 100,
                    is_control: false,
                  },
                ],
              },
            ],
          }),
        );
      }
      if (url.includes(`/ab-tests/bucket/${SITE_ID}`)) return bucket.promise;
      return Promise.resolve(response([]));
    });
    const { dom } = createPage({ fetch });
    openPages.push(dom);
    dom.window.eval(WIDGET_SOURCE);

    const headline =
      dom.window.document.querySelector<HTMLElement>("#headline")!;
    await until(() => headline.hasAttribute("data-rcf-id"));
    targetId = headline.getAttribute("data-rcf-id")!;
    rows.resolve([
      { element_id: targetId, current_content: "Published baseline" },
    ]);

    await until(
      () =>
        headline.textContent === "Published baseline" &&
        startup(dom.window).status === "d",
      350,
    );
    expect(headline).not.toHaveAttribute("data-rcf-variant");
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes("/ab-tests/track")),
    ).toBe(false);

    bucket.resolve(
      response({ assignments: { "test-slow": "variant-slow" }, geo: null }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(headline.textContent).toBe("Published baseline");
    expect(headline).not.toHaveAttribute("data-rcf-variant");
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes("/ab-tests/track")),
    ).toBe(false);
  });

  it("discards public prefetch and permits later authorized private hydration", async () => {
    let page: JSDOM | null = null;
    const fetch = jest.fn((url: string) => {
      if (url.includes("/editor/validate-grant")) {
        return Promise.resolve(
          response({
            valid: true,
            email: "editor@example.com",
            permissions: ["view", "edit"],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            shouldRefresh: false,
          }),
        );
      }
      if (url.includes(`/staging/content/${SITE_ID}`)) {
        const elementId = page?.window.document
          .querySelector("#headline")
          ?.getAttribute("data-rcf-id");
        return Promise.resolve(
          response({
            content: [
              {
                element_id: elementId,
                current_content: "Authorized private draft",
              },
            ],
          }),
        );
      }
      if (url.includes(`/content/${SITE_ID}?`)) return new Promise(() => {});
      return Promise.resolve(response([]));
    });
    const created = createPage({ fetch });
    page = created.dom;
    openPages.push(page);
    page.window.localStorage.setItem(
      `rcf_editor_grant:${SITE_ID}`,
      JSON.stringify({
        grant: "rcfg1.private-device",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        email: "editor@example.com",
        permissions: ["view", "edit"],
        remembered: true,
      }),
    );

    page.window.eval(WIDGET_SOURCE);
    const headline =
      page.window.document.querySelector<HTMLElement>("#headline")!;
    await until(() => headline.textContent === "Authorized private draft");

    expect(startup(page.window).status).toBe("p");
    expect(
      fetch.mock.calls.filter(([url]) =>
        String(url).includes(`/api/content/${SITE_ID}?`),
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes("/ab-tests/")),
    ).toBe(false);
  });
});
