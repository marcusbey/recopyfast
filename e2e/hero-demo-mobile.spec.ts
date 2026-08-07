/**
 * A-32 (touch half) — the pinned hero demo fights touch scrolling.
 *
 * Two things own the demo's `scrollTop` at once. The demo viewport is
 * `overflow-y-auto` (`InteractiveHero.tsx:738`), so a finger over it scrolls it
 * natively; and `applyDemoScroll` (`:172-177`) writes `scrollTop` from the page
 * scroll track on every MotionValue change. Lenis is built without `syncTouch`,
 * `prevent` or `allowNestedScroll` (`useLenis.ts:157-172`) and never calls
 * `preventDefault` on touch, and there is no `overscroll-behavior` or
 * `touch-action` anywhere in `src/`.
 *
 * So a swipe that scrolls the nested element and then chains to the page has
 * the page's value written back over it: the demo snaps back toward its top
 * mid-gesture. Two successive swipes are the shortest sequence that shows it —
 * the first ends inside the demo, the second chains.
 *
 * UNVERIFIED. This spec has not been executed: it needs a dev server and
 * browser binaries. It is written against the finding, not against an observed
 * run, and `test.fail()` below records the expectation, not a measurement.
 *
 * WHY CDP RATHER THAN dispatchEvent. Synthetic `TouchEvent`s are untrusted and
 * produce no scrolling at all, which would make this test measure nothing.
 * `Input.dispatchTouchEvent` goes in as real input. Chromium only, which is the
 * config's only project.
 */

import { test, expect, devices } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ ...devices["iPhone 13"] });

/** The demo site's own scrollable viewport — `siteScrollRef` in InteractiveHero. */
const DEMO_SCROLLER = "[data-demo-surface] .overflow-y-auto";

/** Enough page scroll to reach the demo's sticky track and pin it. */
const APPROACH_PX = 400;
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

  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.75;
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
      touchPoints: [
        { x, y: startY - (SWIPE_DISTANCE_PX * step) / SWIPE_STEPS },
      ],
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

async function openPinnedDemo(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(DEMO_SCROLLER).first().waitFor({ state: "visible" });
  await page.mouse.wheel(0, APPROACH_PX);
  await page.waitForTimeout(600); // Lenis easing
}

test.describe("Hero demo on a phone", () => {
  test.setTimeout(90000);

  /* Guards the test below: an expected failure is only meaningful if the thing
     being measured is actually there and actually scrollable. */
  test("the demo has its own scrollable viewport", async ({ page }) => {
    await openPinnedDemo(page);

    const scroller = page.locator(DEMO_SCROLLER).first();
    await expect(scroller).toBeVisible();

    const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);
  });

  test("two swipes never scroll the demo backwards", async ({ page }) => {
    /* Expected to fail while A-32 is open. If this ever reports "expected to
       fail, but passed", check whether the fix landed before deleting the
       marker — synthetic input is not a finger, and the harness may simply not
       be reproducing the conflict. */
    test.fail();

    await openPinnedDemo(page);

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
