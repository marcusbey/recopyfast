import { expect, test, type Page } from "@playwright/test";

/**
 * s98 - the free-copy-change cost calculator, in a real browser against a
 * production build, at the narrowest width we design for.
 *
 * What only a browser can show: the page hydrates under the marketing Content
 * Security Policy (no script directive refuses a chunk), the result updates as
 * the visitor types, the address bar follows (debounced) and a reload restores
 * the same numbers, and nothing makes the page scroll sideways at 390 px.
 *
 * Script violations only, as in csp.spec.ts: CI serves the build from
 * http://127.0.0.1, where the unchanged `connect-src` refuses local services,
 * which says nothing about this page.
 */

const PATH = "/tools/website-maintenance-cost";
const VIEWPORT_WIDTH = 390;
const SCRIPT_DIRECTIVE = /script-src/;

test.use({ viewport: { width: VIEWPORT_WIDTH, height: 844 } });

async function watchScriptViolations(
  page: Page,
): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy/i.test(text) && SCRIPT_DIRECTIVE.test(text)) {
      fromConsole.push(text);
    }
  });
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations =
      store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => {
    const fromDocument = await page.evaluate(
      () =>
        (window as unknown as { __cspViolations?: string[] }).__cspViolations ??
        [],
    );
    return [
      ...fromConsole,
      ...fromDocument.filter((entry) => SCRIPT_DIRECTIVE.test(entry)),
    ];
  };
}

test("maintenance cost calculator: fill, URL round trip, copyable card, 390 px, CSP clean", async ({
  page,
}) => {
  const scriptViolations = await watchScriptViolations(page);

  await page.goto(PATH);

  // The calculator only exists once hydrated (it reads the URL under
  // Suspense), so a visible default result means React is attached.
  const result = page.getByRole("status", { name: "Result" });
  await expect(result).toContainText("$4,800");

  await page.getByLabel("Sites you maintain").fill("12");
  await page.getByLabel("Copy changes per site, per month").fill("3");
  await page.getByLabel("Minutes per change").fill("20");
  await page.getByLabel("Hourly rate").fill("60");
  await page.getByLabel("Currency").selectOption("EUR");

  await expect(result).toContainText("€8,640");

  await expect(page).toHaveURL(
    /sites=12&changes=3&minutes=20&rate=60&billed=0&currency=EUR/,
  );

  await page.reload();
  await expect(page.getByLabel("Sites you maintain")).toHaveValue("12");
  await expect(page.getByLabel("Currency")).toHaveValue("EUR");
  await expect(page.getByRole("status", { name: "Result" })).toContainText(
    "€8,640",
  );

  await expect(
    page.getByRole("button", { name: "Copy card HTML" }),
  ).toBeVisible();
  await expect(page.locator("pre code").first()).toContainText("<a href=");

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(VIEWPORT_WIDTH);

  expect(await scriptViolations()).toEqual([]);
});
