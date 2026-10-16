import { expect, test } from "@playwright/test";

/** Public runtime exercised in a real document; every external hit is intercepted. */
test("context capture follows consent; withdrawal retries without private Google loads", async ({
  page,
  context,
}) => {
  const actions: string[] = [];
  const google: string[] = [];
  await context.setExtraHTTPHeaders({ "x-vercel-ip-country": "FR" });
  await context.route(
    /https:\/\/.*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//,
    async (route) => {
      google.push(route.request().url());
      const body = `(function(){var q=window.dataLayer||[];var old=window.gtag;window.gtag=function(){if(arguments[0]==='get')arguments[3]('123.456');else old.apply(window,arguments);};q.forEach(function(a){if(a[0]==='get')a[3]('123.456');});})();`;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body,
      });
    },
  );
  let shouldFailRevoke = true;
  await context.route("**/api/analytics/context", async (route) => {
    const action = route.request().postDataJSON().action;
    actions.push(action);
    await route.fulfill(
      action === "grant"
        ? {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ expiresAt: Date.now() + 180 * 86400000 }),
          }
        : {
            status: action === "revoke" && shouldFailRevoke ? 503 : 204,
            body: "",
          },
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Analytics cookies" }),
  ).toBeVisible();
  expect(google).toEqual([]);
  expect(actions).toEqual([]);
  await page
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await expect.poll(() => actions.includes("capture")).toBe(true);
  expect(actions.indexOf("grant")).toBeLessThan(actions.indexOf("capture"));
  // A network capture can precede React committing the banner dismissal.
  // Finish that user-visible transition before asking to reopen the banner.
  await expect(
    page.getByRole("region", { name: "Analytics cookies" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect.poll(() => actions.includes("revoke")).toBe(true);
  await expect
    .poll(async () =>
      (await context.cookies()).some((c) => c.name === "rcf_analytics_pending"),
    )
    .toBe(true);
  shouldFailRevoke = false;
  await page.goto("/login");
  await expect
    .poll(async () =>
      (await context.cookies()).some((c) => c.name === "rcf_analytics_pending"),
    )
    .toBe(false);
  const googleCount = google.length,
    captureCount = actions.filter((x) => x === "capture").length;
  await page
    .getByRole("link", { name: "Terms of Service", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/terms/);
  expect(google.length).toBe(googleCount);
  expect(actions.filter((x) => x === "capture")).toHaveLength(captureCount);
});
