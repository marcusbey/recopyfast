import { expect, test, type Page } from "@playwright/test";
import {
  startFixtureServers,
  type FixtureServers,
  waitForWidget,
} from "./servers";

declare global {
  interface Window {
    __recopyfastFixtureCls?: number;
  }
}

async function installClsObserver(page: Page) {
  await page.addInitScript(() => {
    window.__recopyfastFixtureCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (!shift.hadRecentInput) {
          window.__recopyfastFixtureCls =
            (window.__recopyfastFixtureCls || 0) + (shift.value || 0);
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function measureCls(page: Page, url: string, expectsWidget: boolean) {
  await page.goto(url, { waitUntil: "networkidle" });
  if (expectsWidget) {
    await waitForWidget(page);
  }
  await page.waitForTimeout(750);
  return page.evaluate(() => window.__recopyfastFixtureCls || 0);
}

test.describe("built embed fixture: host-page CLS", () => {
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

  test("contributes at most 0.001 CLS over the same widget-less page", async ({
    page,
  }) => {
    await installClsObserver(page);

    const withoutWidget = await measureCls(
      page,
      fixture.liveUrl({ widget: false }),
      false,
    );
    const withWidget = await measureCls(page, fixture.liveUrl(), true);
    const delta = withWidget - withoutWidget;

    console.log(
      `[embed-fixture CLS] without=${withoutWidget.toFixed(6)} with=${withWidget.toFixed(6)} delta=${delta.toFixed(6)}`,
    );

    expect(delta).toBeLessThanOrEqual(0.001);
  });
});
