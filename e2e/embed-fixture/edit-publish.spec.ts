import { expect, test } from "@playwright/test";
import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

test.describe("built embed fixture: edit and publish", () => {
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

  test("boots the built artifact from a second origin with JavaScript MIME", async ({
    page,
  }) => {
    const artifactResponse = page.waitForResponse(
      (response) =>
        response.url() === `${fixture.servingOrigin}/embed/recopyfast.js`,
    );

    await page.goto(fixture.stagingUrl(), { waitUntil: "networkidle" });
    const response = await artifactResponse;
    await waitForWidget(page);

    expect(new URL(page.url()).origin).toBe(fixture.hostOrigin);
    expect(new URL(response.url()).origin).toBe(fixture.servingOrigin);
    expect(response.headers()["content-type"]).toContain(
      "application/javascript",
    );
    await expect(page.locator("#rcf-staging-banner")).toBeVisible();
  });

  test("edits through the widget and publishes the staged value", async ({
    page,
  }) => {
    await page.goto(fixture.stagingUrl(), { waitUntil: "networkidle" });
    await waitForWidget(page);

    const heading = page.locator(
      `[data-rcf-id="${FIXTURE_ELEMENT_IDS.heading}"]`,
    );
    const editedText = "Edited by the built artifact";

    await heading.click();
    await expect(page.locator(".rcf-actions-inline")).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type(editedText);
    await page.locator(".rcf-btn-save").click();

    await expect(heading).toHaveText(editedText);
    await expect
      .poll(
        () =>
          fixture.api.latestRequest(
            `/api/staging/content/${FIXTURE_SITE_ID}`,
            "PUT",
          )?.json,
      )
      .toMatchObject({
        elementId: FIXTURE_ELEMENT_IDS.heading,
        content: editedText,
      });
    expect(fixture.api.publishedContent(FIXTURE_ELEMENT_IDS.heading)).toBe(
      "Fixture headline",
    );
    expect(fixture.api.stagedContent(FIXTURE_ELEMENT_IDS.heading)).toBe(
      editedText,
    );

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /publish now/i }),
    ).toBeEnabled();
    await page.getByRole("button", { name: /publish now/i }).click();

    await expect
      .poll(
        () => fixture.api.latestRequest("/api/staging/publish", "POST")?.json,
      )
      .toMatchObject({ siteId: FIXTURE_SITE_ID });
    await expect(page.getByText(/published 1 change/i)).toBeVisible();
    expect(fixture.api.publishedContent(FIXTURE_ELEMENT_IDS.heading)).toBe(
      editedText,
    );
    expect(fixture.api.stagedContent(FIXTURE_ELEMENT_IDS.heading)).toBeNull();
  });
});
