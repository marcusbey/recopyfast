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
  await page.locator('.rcf-try-toolbar input[type="file"]').setInputFiles({
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

test("a first click edits a linked heading at the clicked text without activating the link", async ({
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
  await strong.click({ position: { x: 20, y: 8 } });
  await page.keyboard.type("X");
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

test("editing a heading blocks clicks anywhere in its clickable card ancestor", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
      <a id="outer-card" href="https://host.example/card">
        <article id="card" role="button" tabindex="0">
          <h3>Editable card title</h3>
          <p>Inner card body</p>
        </article>
        <p id="outer-card-body">Outer linked card body</p>
      </a>
    </main>
    <script>
      window.hostClicks = 0;
      document.getElementById('outer-card').addEventListener('click', () => window.hostClicks += 1);
    </script>
  `);
  await injectRuntime(page);

  await page.locator("#card h3").click();
  await page.locator("#card h3").click();
  await page.locator("#outer-card-body").click();

  expect(
    await page.evaluate(
      () => (window as unknown as { hostClicks: number }).hostClicks,
    ),
  ).toBe(0);
  await expect(page.locator("#card h3")).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
});

test("editing a button label blocks Space and Enter from host handlers", async ({
  page,
}) => {
  await page.setContent(`
    <main style="margin-top:80px">
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
