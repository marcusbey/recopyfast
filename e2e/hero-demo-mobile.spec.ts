/**
 * A-32 (touch half) — the homepage demo must not fight touch scrolling.
 *
 * Two things used to own the demo's `scrollTop` at once. The demo viewport was
 * `overflow-y-auto` even while pinned, so a finger over it scrolled it
 * natively; and `applyDemoScroll` writes `scrollTop` from the page scroll track
 * on every MotionValue change. Lenis is built without `syncTouch`, `prevent` or
 * `allowNestedScroll` (`useLenis.ts:157-172`) and never calls `preventDefault`
 * on touch, so a swipe that scrolled the nested element and then chained to the
 * page had the page's value written back over it: the demo snapped back toward
 * its top mid-gesture. Two successive swipes are the shortest sequence that
 * shows it — the first ends inside the demo, the second chains.
 *
 * s114 removed the old pinned `HeroDemo` scroll track from the homepage and
 * placed `InteractiveHero` directly in `real-demo-section`. Nothing drives a
 * progress MotionValue there now, so the nested viewport is intentionally
 * `overflow-y-auto`: the reader owns its scroll just as on /demo. This spec
 * keeps the original two-swipe regression on that current surface.
 *
 * WHY CDP RATHER THAN dispatchEvent. Synthetic `TouchEvent`s are untrusted and
 * produce no scrolling at all, which would make this test measure nothing.
 * `Input.dispatchTouchEvent` goes in as real input. Chromium only, which is the
 * config's only project.
 */

import { test, expect, devices } from "@playwright/test";
import type { Page } from "@playwright/test";

// The device profile carries `defaultBrowserType: "webkit"`, which would
// launch mobile WebKit — where `mouse.wheel` and the CDP touch dispatch this
// spec depends on both do not exist. The point of the profile is the
// viewport/touch emulation, not the engine, so pin the engine back.
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

/** The demo site's own scrolling viewport — `siteScrollRef` in InteractiveHero. */
const DEMO_SCROLLER = "[data-demo-scroller]";

const SWIPE_DISTANCE_PX = 260;
const SWIPE_STEPS = 12;

/**
 * One upward flick over the demo, delivered as real touch input.
 *
 * Sampled while the finger is down as well as after it lifts: the snap-back
 * happens during the gesture, and a test that only looked at the end state
 * could miss it entirely.
 */
async function swipeUpOverDemo(page: Page): Promise<number[]> {
  const client = await page.context().newCDPSession(page);
  const box = await page.locator(DEMO_SCROLLER).first().boundingBox();
  expect(box, "the demo viewport must be on screen to swipe it").not.toBeNull();
  if (!box) throw new Error("no demo viewport");

  const viewport = page.viewportSize();
  expect(
    viewport,
    "the mobile context must expose its viewport",
  ).not.toBeNull();
  if (!viewport) throw new Error("no mobile viewport");

  const visible = {
    left: Math.max(0, box.x),
    right: Math.min(viewport.width, box.x + box.width),
    top: Math.max(0, box.y),
    bottom: Math.min(viewport.height, box.y + box.height),
  };
  expect(visible.right - visible.left).toBeGreaterThan(0);
  expect(visible.bottom - visible.top).toBeGreaterThan(SWIPE_DISTANCE_PX + 24);

  const x = visible.left + (visible.right - visible.left) / 2;
  const startY = visible.bottom - 12;
  const endY = startY - SWIPE_DISTANCE_PX;
  expect(startY).toBeGreaterThan(visible.top);
  expect(startY).toBeLessThan(visible.bottom);
  expect(endY).toBeGreaterThan(visible.top);
  expect(endY).toBeLessThan(visible.bottom);
  const samples: number[] = [];

  const sample = async () => {
    samples.push(await demoScrollTop(page));
  };

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY }],
  });
  await sample();

  for (let step = 1; step <= SWIPE_STEPS; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY - ((startY - endY) * step) / SWIPE_STEPS }],
    });
    await page.waitForTimeout(16);
    await sample();
  }

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(400); // momentum, and any write-back behind it
  await sample();

  await client.detach();
  return samples;
}

async function demoScrollTop(page: Page): Promise<number> {
  return page
    .locator(DEMO_SCROLLER)
    .first()
    .evaluate((el) => el.scrollTop);
}

/** Opens the current s114 demo surface and stops its automatic site attract loop. */
async function openDemoViewport(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const section = page.getByTestId("real-demo-section");
  const reload = section.getByRole("button", {
    name: "Reload this site and undo the demo edits",
  });
  await expect(reload).toBeVisible();

  // This hydrated, real control gives the component an actual pointer
  // interaction before any layout measurement, ending the attract loop
  // without opening an editable field.
  await reload.tap();
  await expect(page.locator(DEMO_SCROLLER)).toHaveCount(1);

  const scroller = page.locator(DEMO_SCROLLER).first();
  await scroller.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(scroller).toBeVisible();
}

test.describe("Hero demo on a phone", () => {
  test.setTimeout(90000);

  /* Guards the test below: the swipe measures nothing if the thing being
     swiped is absent or has nothing to scroll through. */
  test("the demo has its own scrolling viewport", async ({ page }) => {
    await openDemoViewport(page);

    const scroller = page.locator(DEMO_SCROLLER).first();
    await expect(scroller).toBeVisible();

    const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);
  });

  test("two swipes never scroll the demo backwards", async ({ page }) => {
    await openDemoViewport(page);

    const samples = [
      await demoScrollTop(page),
      ...(await swipeUpOverDemo(page)),
      ...(await swipeUpOverDemo(page)),
    ];

    // Vacuous otherwise: a demo that never moved is trivially non-decreasing.
    expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);

    for (let index = 1; index < samples.length; index++) {
      expect(
        samples[index],
        `sample ${index} of ${JSON.stringify(samples)} went backwards`,
      ).toBeGreaterThanOrEqual(samples[index - 1]);
    }
  });
});
