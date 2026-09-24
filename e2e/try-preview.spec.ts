import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const RUNTIME_PATH = resolve(process.cwd(), "public/try/rcf-try.js");

test("the standalone preview edits a local heading without transport", async ({
  page,
}) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <head><title>Local agency fixture</title></head>
      <body>
        <nav><a href="/work">Work</a></nav>
        <main style="margin-top: 80px">
          <h1>Original client headline</h1>
          <p>Original supporting copy.</p>
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

  await page.addScriptTag({ path: RUNTIME_PATH });

  const heading = page.locator("main h1");
  await expect(heading).toHaveText("Original client headline");
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __tryTransport: { requests: number } })
            .__tryTransport.requests,
      ),
    )
    .toBe(0);

  await page.locator("#rcf-try-exit").click();
  await expect(page.locator('[data-rcf-try-ui="true"]')).toHaveCount(0);
  await expect(heading).not.toHaveAttribute("contenteditable", /.+/);
});
