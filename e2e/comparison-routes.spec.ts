import { expect, test } from "@playwright/test";
import { buildComparisonLighthouseUrls } from "../src/lib/compare/lighthouse";

const APP_ORIGIN = new URL(
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
).origin;

const KNOWN_COMPARISON_URLS = buildComparisonLighthouseUrls(APP_ORIGIN);
const UNKNOWN_COMPARISON_PATHS = [
  "/compare/not-a-real-competitor",
  "/compare/__proto__",
  "/compare/constructor",
] as const;

test("the registry-derived comparison hub and details return 200", async ({
  request,
}) => {
  for (const url of KNOWN_COMPARISON_URLS) {
    await test.step(new URL(url).pathname, async () => {
      const response = await request.get(url, {
        failOnStatusCode: false,
        maxRedirects: 0,
      });

      expect(response.status()).toBe(200);
      expect(response.headers().location).toBeUndefined();
    });
  }
});

test("unknown and prototype-shaped comparison slugs return 404 without redirecting", async ({
  request,
}) => {
  for (const pathname of UNKNOWN_COMPARISON_PATHS) {
    await test.step(pathname, async () => {
      const response = await request.get(`${APP_ORIGIN}${pathname}`, {
        failOnStatusCode: false,
        maxRedirects: 0,
      });

      expect(response.status()).toBe(404);
      expect(response.headers().location).toBeUndefined();
    });
  }
});
