import { expect, test } from "@playwright/test";
import {
  FIXTURE_ELEMENT_IDS,
  FIXTURE_SITE_ID,
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("built embed fixture: languages and images", () => {
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

  test("adds a language through the widget and re-renders the panel", async ({
    page,
  }) => {
    await page.goto(fixture.stagingUrl(), { waitUntil: "networkidle" });
    await waitForWidget(page);

    await page.getByRole("button", { name: "Edit Board" }).click();
    await page.getByRole("button", { name: "Languages", exact: true }).click();
    await expect(page.getByText("English (en)")).toBeVisible();

    await page.locator(".rcf-eb-select").selectOption("fr");
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "Add Language" }).click();

    await expect
      .poll(
        () =>
          fixture.api.latestRequest("/api/edit-board/languages", "POST")?.json,
      )
      .toMatchObject({
        siteId: FIXTURE_SITE_ID,
        languageCode: "fr",
        autoTranslate: false,
      });
    await expect(page.getByText("French (fr)")).toBeVisible();
  });

  test("uploads an image and saves the returned URL into staging", async ({
    page,
  }) => {
    await page.goto(fixture.stagingUrl(), { waitUntil: "networkidle" });
    await waitForWidget(page);

    const image = page.locator(`[data-rcf-id="${FIXTURE_ELEMENT_IDS.image}"]`);
    const previousSrc = await image.getAttribute("src");

    await image.click();
    await expect(
      page.getByRole("heading", { name: "Edit Image" }),
    ).toBeVisible();
    await page.locator('.rcf-modal input[type="file"]').setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    await expect(page.getByText(/uploaded.*320.*180/i)).toBeVisible();
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(image).toHaveAttribute("src", fixture.api.replacementImageUrl);
    expect(await image.getAttribute("src")).not.toBe(previousSrc);

    const upload = fixture.api.latestRequest("/api/upload/image", "POST");
    expect(upload?.rawBody.byteLength).toBeGreaterThan(0);
    expect(upload?.headers["content-type"]).toContain("multipart/form-data");
    await expect
      .poll(
        () =>
          fixture.api.latestRequest(
            `/api/staging/content/${FIXTURE_SITE_ID}`,
            "PUT",
          )?.json,
      )
      .toMatchObject({
        elementId: FIXTURE_ELEMENT_IDS.image,
        content: fixture.api.replacementImageUrl,
        contentType: "image",
      });
  });
});
