import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const RUNTIME_PATH = resolve(process.cwd(), "public/try/rcf-try.js");
const RUNTIME_URL = "https://www.recopyfa.st/try/rcf-try.js";

async function injectRuntime(page: Page) {
  await page.route(RUNTIME_URL, async (route) => {
    await route.fulfill({
      body: readFileSync(RUNTIME_PATH),
      contentType: "application/javascript; charset=utf-8",
    });
  });
  await page.evaluate((src) => {
    const script = document.createElement("script");
    script.src = src;
    document.head.appendChild(script);
  }, RUNTIME_URL);
  await expect(page.locator("#rcf-try-topbar")).toBeVisible();
}

test("the standalone preview completes its full local flow with only the script request", async ({
  page,
}) => {
  const requests: string[] = [];
  const sockets: string[] = [];
  await page.route("https://beacon.example.invalid/**", (route) =>
    route.abort(),
  );
  page.on("request", (request) => requests.push(request.url()));
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await page.setContent(`
    <!doctype html>
    <html>
      <head><title>Local agency fixture</title></head>
      <body>
        <main style="margin-top: 80px">
          <h1>Original client headline</h1>
          <img alt="Local sample" src="data:image/png;base64,AA==">
        </main>
      </body>
    </html>
  `);
  await page.evaluate(() => {
    const state = { requests: 0 };
    Object.defineProperty(window, "__tryTransport", { value: state });
    window.fetch = (() => {
      state.requests += 1;
      return Promise.reject(new Error("preview attempted fetch"));
    }) as typeof fetch;
    XMLHttpRequest.prototype.send = function () {
      state.requests += 1;
      throw new Error("preview attempted XMLHttpRequest");
    };
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: () => {
        state.requests += 1;
        return false;
      },
    });
  });

  await injectRuntime(page);

  const heading = page.locator("main h1");
  await heading.click();
  await expect(heading).toHaveAttribute("contenteditable", "plaintext-only");
  await expect(heading).toHaveAttribute("data-rcf-try-editing", "true");
  await heading.fill("A sharper client headline");
  await page
    .locator('.rcf-try-toolbar[data-rcf-try-ui="true"]')
    .getByRole("button", { name: "Save" })
    .click();
  await expect(heading).toHaveText("A sharper client headline");
  await expect(heading).toHaveAttribute("data-rcf-try-published", "true");
  await expect(page.locator(".rcf-try-status")).toHaveText(
    "Published (preview)",
  );

  await page.locator("main img").click();
  const fileInput = page.locator('.rcf-try-toolbar input[type="file"]');
  await fileInput.setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.locator(".rcf-try-error")).toHaveText(
    "Choose an image that is 5 MB or smaller.",
  );
  await fileInput.setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator("main img")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await expect
    .poll(() =>
      page
        .locator("main img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.locator("main img").click();
  await page.locator('.rcf-try-toolbar input[type="file"]').setInputFiles({
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.locator(".rcf-try-error")).toHaveText(
    "That image is empty or corrupt. Choose another file.",
  );

  await page.locator("#rcf-try-exit").click();
  await expect(page.locator('[data-rcf-try-ui="true"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __tryTransport: { requests: number } })
            .__tryTransport.requests,
      ),
    )
    .toBe(0);
  expect(sockets).toEqual([]);
  expect(requests).toEqual([RUNTIME_URL]);
  await expect(heading).not.toHaveAttribute("contenteditable", /.+/);
});

test("Alt-click edits a linked heading label without activating its anchor", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
      <a id="card-link" href="https://host.example/work">
        <h2><span>Build </span><strong>better</strong><span> websites</span></h2>
      </a>
    </main>
    <script>
      window.hostClicks = 0;
      document.getElementById('card-link').addEventListener('click', () => window.hostClicks += 1);
    </script>
  `);
  await injectRuntime(page);

  const strong = page.locator("#card-link strong");
  await strong.click({ position: { x: 20, y: 8 }, modifiers: ["Alt"] });
  await page.keyboard.insertText("X");
  await strong.click({ position: { x: 25, y: 8 } });

  await expect(page.locator("#card-link h2")).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
  await expect(strong).toContainText("X");
  expect(await page.evaluate(() => window.location.href)).toBe("about:blank");
  expect(
    await page.evaluate(
      () => (window as unknown as { hostClicks: number }).hostClicks,
    ),
  ).toBe(0);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#card-link strong")).toContainText("X");
});

test("WordPress, Bootstrap, and mega-menu links navigate normally unless Alt-clicked", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
      <nav id="wordpress-menu">
        <ul><li class="menu-item"><a href="#wordpress-target">WordPress page</a></li></ul>
      </nav>
      <ul class="navbar-nav">
        <li class="nav-item"><a class="nav-link" href="#bootstrap-target">Bootstrap page</a></li>
      </ul>
      <nav id="mega-menu">
        <ul>
          <li class="mega-menu-item">
            <a href="#mega-target">Mega page</a>
            <div class="mega-panel"><p>Products and resources</p></div>
          </li>
        </ul>
      </nav>
      <div class="actions"><a id="hero-cta" class="btn" href="#hero-target">Get started</a></div>
      <p><a id="paragraph-cta" class="button" href="#paragraph-target">Book a call</a></p>
      <ul><li><a id="content-link" href="#content-target">Works with WordPress and Webflow</a></li></ul>
    </main>
  `);
  await injectRuntime(page);

  await page.locator("#wordpress-menu li").dispatchEvent("click");
  await expect(page.locator("#wordpress-menu li")).not.toHaveAttribute(
    "contenteditable",
    /.+/,
  );

  for (const [selector, hash] of [
    ["#wordpress-menu a", "#wordpress-target"],
    [".navbar-nav a", "#bootstrap-target"],
    ["#mega-menu > ul > li > a", "#mega-target"],
    ["#hero-cta", "#hero-target"],
    ["#paragraph-cta", "#paragraph-target"],
    ["#content-link", "#content-target"],
  ] as const) {
    const link = page.locator(selector);
    await link.hover();
    await expect(link).not.toHaveAttribute("data-rcf-try-hover", "true");
    await link.click();
    await expect.poll(() => new URL(page.url()).hash).toBe(hash);
    await expect(link).not.toHaveAttribute("contenteditable", /.+/);
    await expect(link.locator("xpath=..")).not.toHaveAttribute(
      "contenteditable",
      /.+/,
    );
  }

  const wordpressLink = page.locator("#wordpress-menu a");
  await wordpressLink.click({ modifiers: ["Alt"] });
  await expect(wordpressLink).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
});

test("editing a heading blocks clicks anywhere in its immediate clickable card ancestor", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
      <a id="outer-card" href="#card-target" style="display:block;padding:24px">
        <div class="card-body">
          <h3>Editable card title</h3>
          <span id="outer-card-body">Linked card body</span>
        </div>
      </a>
    </main>
    <script>
      window.hostClicks = 0;
      document.getElementById('outer-card').addEventListener('click', () => window.hostClicks += 1);
    </script>
  `);
  await injectRuntime(page);

  await page.locator("#outer-card h3").click({ modifiers: ["Alt"] });
  await page.locator("#outer-card h3").click();
  await page.locator("#outer-card-body").click();

  expect(
    await page.evaluate(
      () => (window as unknown as { hostClicks: number }).hostClicks,
    ),
  ).toBe(0);
  await expect(page.locator("#outer-card h3")).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
});

test("editing a button label blocks Space and Enter from host handlers", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
      <p id="copy">Ordinary copy</p>
      <button id="cta" type="button">Start now</button>
    </main>
    <script>
      window.hostEvents = [];
      const button = document.getElementById('cta');
      button.addEventListener('click', () => window.hostEvents.push('click'));
      for (const type of ['keydown', 'keypress', 'keyup']) {
        button.addEventListener(type, event => window.hostEvents.push(type + ':' + event.key));
      }
    </script>
  `);
  await injectRuntime(page);

  const copy = page.locator("#copy");
  const originalCopy = await copy.innerText();
  await copy.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" native");
  const beforeEnter = await copy.innerText();
  expect(beforeEnter).not.toBe(originalCopy);
  await page.keyboard.press("Enter");
  const afterEnter = await copy.innerText();
  expect(afterEnter).not.toBe(beforeEnter);
  await page.keyboard.press("ControlOrMeta+z");
  const afterUndo = await copy.innerText();
  expect(afterUndo).not.toBe(afterEnter);
  expect([originalCopy, beforeEnter]).toContain(afterUndo);
  await page.getByRole("button", { name: "Cancel" }).click();

  const originalLabel = await page.locator("#cta").textContent();
  await page.locator("#cta").click();
  await page.locator("#cta").click();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");

  expect(
    await page.evaluate(
      () => (window as unknown as { hostEvents: string[] }).hostEvents,
    ),
  ).toEqual([]);
  const editedLabel = await page.locator("#cta").textContent();
  expect(editedLabel).toContain("\n");
  expect(editedLabel).toHaveLength((originalLabel || "").length + 2);
  await expect(page.locator("#cta")).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
});
