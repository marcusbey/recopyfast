import { expect, test } from "@playwright/test";
import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  FIXTURE_STAGING_TOKEN,
  FIXTURE_TEXT,
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

const STAGING_WRITE_DELAY_MS = 400;

test.describe("built embed fixture: staging and history", () => {
  let fixture: FixtureServers;

  test.beforeAll(async () => {
    fixture = await startFixtureServers({
      beforeApiRequest: async ({ method, pathname }) => {
        if (
          method === "PUT" &&
          pathname === `/api/staging/content/${FIXTURE_SITE_ID}`
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, STAGING_WRITE_DELAY_MS),
          );
        }
      },
    });
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
    await expect
      .poll(
        () =>
          fixture.api.latestRequest(
            `/api/staging/content/${FIXTURE_SITE_ID}`,
            "PUT",
          )?.json,
      )
      .toMatchObject({
        elementId: FIXTURE_ELEMENT_IDS.copy,
        content: stagedText,
      });
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
      .poll(() => fixture.api.latestRequest("/api/edit-board/history", "GET"))
      .not.toBeUndefined();
    const historyRequest = fixture.api.latestRequest(
      "/api/edit-board/history",
      "GET",
    );
    expect(historyRequest?.search).toEqual({ siteId: FIXTURE_SITE_ID });
    expect(historyRequest?.headers.authorization).toBe(
      `Bearer ${FIXTURE_STAGING_TOKEN}`,
    );

    await page
      .locator(".rcf-eb-card", { hasText: "Version 2" })
      .getByRole("button", { name: "Restore" })
      .click();

    await expect
      .poll(() =>
        fixture.api.latestRequest("/api/edit-board/history/version-2", "POST"),
      )
      .not.toBeUndefined();
    const restoreRequest = fixture.api.latestRequest(
      "/api/edit-board/history/version-2",
      "POST",
    );
    expect(restoreRequest?.headers.authorization).toBe(
      `Bearer ${FIXTURE_STAGING_TOKEN}`,
    );
    await expect(
      page.getByText("Version restored", { exact: true }),
    ).toBeVisible();
    expect(fixture.api.stagedContent(FIXTURE_ELEMENT_IDS.copy)).toBe(
      FIXTURE_TEXT.copy,
    );
    await expect(copy).toHaveText(FIXTURE_TEXT.copy, { timeout: 10_000 });
  });
});
