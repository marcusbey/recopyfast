import { JSDOM } from "jsdom";
import { buildStableEmbedInstallation } from "../embed-script";

interface StartupState {
  k: string;
  status: string;
  at: number | null;
  content: Promise<unknown>;
  can: () => boolean;
  fail: (reason: string) => void;
  done: () => void;
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
  appUrl?: string;
  blockInitialStyle?: boolean;
}) {
  const fetchImpl = options.fetchImpl ?? jest.fn(() => new Promise(() => {}));
  const installation = buildStableEmbedInstallation({
    siteId: options.siteId ?? "site-123",
    siteToken: options.siteToken ?? "site-token-abc",
    appUrl: options.appUrl ?? "https://api.example",
  });
  let nativeAttachShadow: typeof Element.prototype.attachShadow | undefined;
  const dom = new JSDOM(
    `<!doctype html><html><head>${installation.headBootstrap}</head><body>${options.body ?? ""}</body></html>`,
    {
      runScripts: "dangerously",
      url:
        options.url ??
        "https://customer.example/pricing/index.html?rcf_token=secret#plans",
      beforeParse(window) {
        nativeAttachShadow = window.Element.prototype.attachShadow;
        if (options.blockInitialStyle) {
          Object.defineProperty(window.HTMLStyleElement.prototype, "sheet", {
            configurable: true,
            get: () => null,
          });
        }
        Object.defineProperty(window, "fetch", {
          configurable: true,
          value: fetchImpl,
        });
      },
    },
  );

  const startup = (dom.window as unknown as { __rcfStartup: StartupState })
    .__rcfStartup;
  return { dom, fetchImpl, installation, startup, nativeAttachShadow };
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
    expect(startup.k).toBe("2\0site-123\0https://api.example/api\0/pricing");
  });

  it("sends only the bare origin referrer to a trusted same-origin API", () => {
    const { fetchImpl } = bootDocument({
      appUrl: "https://customer.example",
      url: "https://customer.example/pricing?rcf_token=secret#plans",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://customer.example/api/content/site-123?page_path=%2Fpricing",
      expect.objectContaining({
        credentials: "omit",
        headers: { Authorization: "Bearer site-token-abc" },
        referrer: "https://customer.example/",
        referrerPolicy: "origin",
      }),
    );
    const options = JSON.stringify(fetchImpl.mock.calls[0][1]);
    expect(options).not.toContain("pricing");
    expect(options).not.toContain("rcf_token");
    expect(options).not.toContain("secret");
  });

  it("fails safe without a request when the configured API URL is invalid", () => {
    const { fetchImpl, startup } = bootDocument({ appUrl: ":invalid:" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(startup).toMatchObject({ status: "f", code: "x" });
  });

  it("conceals eligible direct text but excludes ignored, editable and structural wrappers", async () => {
    const { dom } = bootDocument({});
    const document = dom.window.document;
    document.body.innerHTML = `
      <h1 id="held">Published headline target</h1>
      <p data-rcf-ignore id="ignored">Ignored copy</p>
      <div contenteditable="true"><span id="editable">Draft copy</span></div>
      <div contenteditable><span id="editable-empty">Draft shorthand</span></div>
      <div contenteditable="plaintext-only"><span id="editable-plain">Draft plain text</span></div>
      <div id="structural"><span>Child text only</span></div>
      <div data-rcf-content id="region"><strong>Explicit region</strong></div>
      <button id="split">A<span>B</span></button>
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
    expect(document.querySelector("#editable-empty")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#editable-plain")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#structural")).not.toHaveAttribute(
      "data-rcf-startup-held",
    );
    expect(document.querySelector("#structural span")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(document.querySelector("#split")).toHaveAttribute(
      "data-rcf-startup-held",
      "",
    );
    expect(document.querySelectorAll("[data-rcf-startup-held]")).toHaveLength(
      4,
    );
  });

  it("arms the 200 ms recovery deadline on the first managed concealment", async () => {
    jest.useFakeTimers();
    const { dom, startup, nativeAttachShadow } = bootDocument({});
    const heading = dom.window.document.createElement("h1");
    heading.textContent = "Authored headline";
    dom.window.document.body.appendChild(heading);
    await mutations();

    expect(startup.status).toBe("h");
    expect(dom.window.Element.prototype.attachShadow).not.toBe(
      nativeAttachShadow,
    );
    expect(heading).toHaveAttribute("data-rcf-startup-held", "");

    jest.advanceTimersByTime(199);
    expect(heading).toHaveAttribute("data-rcf-startup-held", "");
    jest.advanceTimersByTime(1);

    expect(startup.status).toBe("f");
    expect(heading).not.toHaveAttribute("data-rcf-startup-held");
    expect(dom.window.Element.prototype.attachShadow).toBe(nativeAttachShadow);
    const lateRoot = dom.window.document
      .createElement("div")
      .attachShadow({ mode: "open" });
    expect(lateRoot.querySelector("style[data-rcf-startup-style]")).toBeNull();
  });

  it("restores the native shadow hook after apply without clobbering a host override", () => {
    const applied = bootDocument({ body: "<h1>Managed copy</h1>" });
    applied.startup.done();
    expect(applied.dom.window.Element.prototype.attachShadow).toBe(
      applied.nativeAttachShadow,
    );

    const overridden = bootDocument({ body: "<h1>Managed copy</h1>" });
    const startupHook = overridden.dom.window.Element.prototype.attachShadow;
    const hostOverride = function (
      this: Element,
      options: ShadowRootInit,
    ): ShadowRoot {
      return startupHook.call(this, options);
    };
    overridden.dom.window.Element.prototype.attachShadow = hostOverride;
    overridden.startup.fail("d");
    expect(overridden.dom.window.Element.prototype.attachShadow).toBe(
      hostOverride,
    );
    const delegatedRoot = overridden.dom.window.document
      .createElement("div")
      .attachShadow({ mode: "open" });
    expect(
      delegatedRoot.querySelector("style[data-rcf-startup-style]"),
    ).toBeNull();
  });

  it("restores attachShadow when CSP blocks the initial gate style", () => {
    const { dom, startup, nativeAttachShadow } = bootDocument({
      body: "<h1>Authored copy</h1>",
      blockInitialStyle: true,
    });

    expect(startup).toMatchObject({ status: "f", code: "s" });
    expect(dom.window.Element.prototype.attachShadow).toBe(nativeAttachShadow);
  });

  it("does not re-arm shadow gating after a host-style failure settles startup", async () => {
    const { dom, startup, nativeAttachShadow } = bootDocument({});
    const document = dom.window.document;
    const firstHost = document.createElement("div");
    const secondHost = document.createElement("div");
    const firstRoot = nativeAttachShadow!.call(firstHost, { mode: "open" });
    const secondRoot = nativeAttachShadow!.call(secondHost, { mode: "open" });
    firstRoot.innerHTML = '<h2 id="shadow-failure">Authored first</h2>';
    secondRoot.innerHTML = "<h2>Authored second</h2>";
    const nativeGetComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    jest.spyOn(dom.window, "getComputedStyle").mockImplementation((element) => {
      if ((element as HTMLElement).id === "shadow-failure") {
        return { visibility: "visible" } as CSSStyleDeclaration;
      }
      return nativeGetComputedStyle(element);
    });

    const fragment = document.createDocumentFragment();
    fragment.append(firstHost, secondHost);
    document.body.appendChild(fragment);
    await mutations();

    expect(startup).toMatchObject({ status: "f", code: "s" });
    expect(firstRoot.querySelector("style[data-rcf-startup-style]")).toBeNull();
    expect(
      secondRoot.querySelector("style[data-rcf-startup-style]"),
    ).toBeNull();

    firstRoot.appendChild(document.createElement("span"));
    await mutations();
    expect(firstRoot.querySelector("style[data-rcf-startup-style]")).toBeNull();
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
    const { dom } = bootDocument({
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
    const { dom } = bootDocument({});
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
