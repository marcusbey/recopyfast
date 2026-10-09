import { expect, test } from "@playwright/test";
import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

test.describe("built embed fixture: staging and history", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: FixtureServers;

  test.beforeAll(async () => {
    fixture = await startFixtureServers();
  });

  test.beforeEach(() => {
    fixture.api.reset();
  });

  test.afterAll(async () => {
    await fixture.close();
  });

  test("keeps an edit staged and restores a listed version", async ({
    page,
  }) => {
    await page.goto(fixture.stagingUrl(), { waitUntil: "networkidle" });
    await waitForWidget(page);

    await expect(page.locator("#rcf-staging-banner")).toBeVisible();
    await expect
      .poll(
        () => fixture.api.latestRequest("/api/staging/validate", "POST")?.json,
      )
      .toMatchObject({ siteId: FIXTURE_SITE_ID });

    const copy = page.locator(`[data-rcf-id="${FIXTURE_ELEMENT_IDS.copy}"]`);
    const stagedText = "This value must remain staged";
    await copy.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type(stagedText);
    await page.locator(".rcf-btn-save").click();

    await expect(copy).toHaveText(stagedText);
    expect(fixture.api.stagedContent(FIXTURE_ELEMENT_IDS.copy)).toBe(
      stagedText,
    );
    expect(fixture.api.publishedContent(FIXTURE_ELEMENT_IDS.copy)).toBe(
      "Fixture body copy.",
    );

    await page.getByRole("button", { name: "Edit Board" }).click();
    await page.getByRole("button", { name: "History", exact: true }).click();

    await expect(page.getByText("Version 2")).toBeVisible();
    await expect(page.getByText("Fixture checkpoint")).toBeVisible();
    await expect
      .poll(
        () =>
          fixture.api.latestRequest("/api/edit-board/history", "GET")?.method,
      )
      .toBe("GET");

    await page
      .locator(".rcf-eb-card", { hasText: "Version 2" })
      .getByRole("button", { name: "Restore" })
      .click();

    await expect
      .poll(
        () =>
          fixture.api.latestRequest("/api/edit-board/history/version-2", "POST")
            ?.method,
      )
      .toBe("POST");
    await expect(page.getByText(/restored 3 elements/i)).toBeVisible();
  });
});
