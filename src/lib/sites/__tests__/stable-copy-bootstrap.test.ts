import { JSDOM } from "jsdom";
import { buildStableEmbedInstallation } from "../embed-script";

interface StartupState {
  api: string;
  path: string;
  v: string;
  site: string;
  status: string;
  at: number | null;
  content: Promise<unknown>;
  can: () => boolean;
  fail: (reason: string) => void;
  snap: (widget: unknown) => unknown;
  apply: (
    widget: unknown,
    rows: unknown[],
    includeVariants: boolean,
    snapshots: unknown,
  ) => unknown;
}

function bootDocument(options: {
  body?: string;
  url?: string;
  fetchImpl?: jest.Mock;
  siteId?: string;
  siteToken?: string;
}) {
  const fetchImpl = options.fetchImpl ?? jest.fn(() => new Promise(() => {}));
  const installation = buildStableEmbedInstallation({
    siteId: options.siteId ?? "site-123",
    siteToken: options.siteToken ?? "site-token-abc",
    appUrl: "https://api.example",
  });
  const dom = new JSDOM(
    `<!doctype html><html><head>${installation.headBootstrap}</head><body>${options.body ?? ""}</body></html>`,
    {
      runScripts: "dangerously",
      url:
        options.url ??
        "https://customer.example/pricing/index.html?rcf_token=secret#plans",
      beforeParse(window) {
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: fetchImpl,
        });
      },
    },
  );

  const startup = (dom.window as unknown as { __rcfStartup: StartupState })
    .__rcfStartup;
  return { dom, fetchImpl, installation, startup };
}

async function mutations() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("stable-copy head bootstrap", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts one public content read in head with no referrer or URL credential", () => {
    const { fetchImpl, startup } = bootDocument({});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example/api/content/site-123?page_path=%2Fpricing",
      expect.objectContaining({
        credentials: "omit",
        headers: { Authorization: "Bearer site-token-abc" },
        referrerPolicy: "no-referrer",
      }),
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(`${url}${JSON.stringify(init)}`).not.toContain("rcf_token");
    expect(`${url}${JSON.stringify(init)}`).not.toContain("secret");
    expect(startup).toMatchObject({
      v: "2",
      site: "site-123",
      api: "https://api.example/api",
    });
    expect(startup.path).toBe("/pricing");
  });

  it("conceals eligible direct text but excludes ignored, editable and structural wrappers", async () => {
    const { dom, startup } = bootDocument({});
    const document = dom.window.document;
    document.body.innerHTML = `
      <h1 id="held">Published headline target</h1>
      <p data-rcf-ignore id="ignored">Ignored copy</p>
      <div contenteditable="true"><span id="editable">Draft copy</span></div>
      <div id="structural"><span>Child text only</span></div>
      <div data-rcf-content id="region"><strong>Explicit region</strong></div>
    `;

    await mutations();

    expect(document.querySelector("#held")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(document.querySelector("#region")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(document.querySelector("#ignored")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#editable")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#structural")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#structural span")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(document.querySelectorAll("[data-rcf-startup-held]")).toHaveLength(
      3,
    );
  });

  it("arms the 200 ms recovery deadline on the first managed concealment", async () => {
    jest.useFakeTimers();
    const { dom, startup } = bootDocument({});
    const heading = dom.window.document.createElement("h1");
    heading.textContent = "Authored headline";
    dom.window.document.body.appendChild(heading);
    await mutations();

    expect(startup.status).toBe("h");
    expect(heading).toHaveAttribute("data-rcf-startup-held", "");

    jest.advanceTimersByTime(199);
    expect(heading).toHaveAttribute("data-rcf-startup-held", "");
    jest.advanceTimersByTime(1);

    expect(startup.status).toBe("f");
    expect(heading).not.toHaveAttribute("data-rcf-startup-held");
  });

  it("checks the deadline when the first concealment began at monotonic time zero", async () => {
    const { dom, startup } = bootDocument({});
    const heading = dom.window.document.createElement("h1");
    heading.textContent = "Authored headline";
    dom.window.document.body.appendChild(heading);
    await mutations();

    startup.at = 0;
    Object.defineProperty(dom.window.performance, "now", {
      configurable: true,
      value: () => 201,
    });

    expect(startup.can()).toBe(false);
  });

  it("reclassifies a parser-added text node through its eligible parent", async () => {
    const { dom, startup } = bootDocument({
      body: "<p>Keep the startup gate active</p>",
    });
    const heading = dom.window.document.createElement("h1");
    dom.window.document.body.appendChild(heading);
    await mutations();
    expect(heading).not.toHaveAttribute("data-rcf-startup-held");

    heading.appendChild(
      dom.window.document.createTextNode("Streamed headline"),
    );
    await mutations();

    expect(heading).toHaveAttribute("data-rcf-startup-held", "");
    expect(
      dom.window.document.querySelectorAll("[data-rcf-startup-held]"),
    ).toHaveLength(2);
  });

  it("settles a rejected public read without leaking a rejected host promise", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("blocked"));
    const { startup } = bootDocument({
      body: "<h1>Authored headline</h1>",
      fetchImpl,
    });

    await expect(startup.content).resolves.toBeNull();
    expect(startup.status).toBe("f");
  });

  it("installs the gate inside open shadow roots present during startup", async () => {
    const { dom, startup } = bootDocument({});
    const host = dom.window.document.createElement("div");
    const root = host.attachShadow({ mode: "open" });

    expect(root.querySelector("style[data-rcf-startup-style]")).not.toBeNull();

    root.innerHTML = "<h2>Shadow headline</h2>";
    dom.window.document.body.appendChild(host);
    await mutations();

    expect(root.querySelector("style[data-rcf-startup-style]")).not.toBeNull();
    expect(root.querySelector("h2")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(root.querySelectorAll("[data-rcf-startup-held]")).toHaveLength(1);
  });

  it("leaves closed shadow roots outside the supported startup gate", async () => {
    const { dom, startup } = bootDocument({
      body: "<p>Keep the document gate active</p>",
    });
    const host = dom.window.document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<h2>Closed authored copy</h2>";
    dom.window.document.body.appendChild(host);
    await mutations();

    expect(root.querySelector("style[data-rcf-startup-style]")).toBeNull();
    expect(root.querySelector("h2")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(startup.status).toBe("h");
  });

  it("rolls back earlier DOM and map writes when a later host write throws", async () => {
    const { dom, startup } = bootDocument({
      body: '<h1 data-rcf-content id="first"><span>Authored first</span></h1><p id="second">Authored second</p>',
    });
    const first = dom.window.document.querySelector<HTMLElement>("#first")!;
    const second = dom.window.document.querySelector<HTMLElement>("#second")!;
    const originalChild = first.firstChild;
    const firstData = { element: first, originalContent: first.textContent };
    const secondData = { element: second, originalContent: second.textContent };
    const widget = {
      elements: new Map([
        ["first", firstData],
        ["second", secondData],
      ]),
      activeTests: [],
      variantAssignments: {},
      applyStoredContent: () => {
        first.setAttribute("data-rcf-test", "partial");
        first.textContent = "Published first";
        firstData.originalContent = "Published first";
        throw new Error("host setter failed");
      },
      applyVariants: () => [],
    };
    const snapshots = startup.snap(widget);

    expect(startup.apply(widget, [], false, snapshots)).toBeNull();

    expect(startup).toMatchObject({ status: "f", code: "x" });
    expect(first.textContent).toBe("Authored first");
    expect(first.firstChild).toBe(originalChild);
    expect(first).not.toHaveAttribute("data-rcf-test");
    expect(firstData.originalContent).toBe("Authored first");
    expect(second.textContent).toBe("Authored second");
    expect(secondData.originalContent).toBe("Authored second");
  });

  it("reuses an identical installation instead of issuing a duplicate read", () => {
    const { dom, fetchImpl, installation, startup } = bootDocument({});
    const duplicate = dom.window.document.createElement("script");
    for (const attribute of Array.from(
      new JSDOM(installation.headBootstrap).window.document.querySelector(
        "script",
      )!.attributes,
    )) {
      duplicate.setAttribute(attribute.name, attribute.value);
    }
    duplicate.textContent = installation.headBootstrap.slice(
      installation.headBootstrap.indexOf(">") + 1,
      installation.headBootstrap.lastIndexOf("</script>"),
    );
    dom.window.document.head.appendChild(duplicate);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      (dom.window as unknown as { __rcfStartup: StartupState }).__rcfStartup,
    ).toBe(startup);
  });

  it("fails closed when a second installation targets another site", () => {
    const first = bootDocument({});
    const other = buildStableEmbedInstallation({
      siteId: "site-456",
      siteToken: "other-token",
      appUrl: "https://api.example",
    });
    const document = first.dom.window.document;
    const parsed = new JSDOM(other.headBootstrap).window.document.querySelector(
      "script",
    )!;
    const second = document.createElement("script");
    for (const attribute of Array.from(parsed.attributes)) {
      second.setAttribute(attribute.name, attribute.value);
    }
    second.textContent = parsed.textContent;
    document.head.appendChild(second);

    expect(first.fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.startup.status).toBe("f");
  });
});
