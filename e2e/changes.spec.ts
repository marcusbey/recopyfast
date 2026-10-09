import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  countsFor,
  EMBED_ELEMENT_IDS,
  type FixtureCounts,
  HERO,
  NORTHWIND_DRAFT,
  NORTHWIND_ID,
  routeChangesFixtures,
  SELECTORS,
  SITES,
} from "./support/changes-fixtures";
import { createLocalServiceRoleClient } from "./support/local-supabase";
import {
  createLayoutOwnerFixture,
  deleteLayoutOwner,
  seedLayoutOwner,
  signInAsLayoutOwner,
} from "./support/owner-session";

/**
 * s70b — the Changes page, measured in a real browser.
 *
 * The page it replaces titled every card with the embed's element id and a
 * CSS selector (`div:nth-child(7) > div > button:nth-child(3) > …`), and jsdom
 * computes no layout, so these are the proofs the unit suites cannot give, on
 * the s66a signed-in harness (a throwaway owner on the disposable local
 * stack). Every list the page reads is a `page.route` fixture
 * (support/changes-fixtures.ts): `.example` domains and `@example.com`
 * addresses only.
 *
 * 1. At 1280 nothing passes the content edge, both site panels and their page
 *    bands render, and no `rcf-` id or `>` selector reaches the page's text.
 *    Picking a site reloads the rows, never the filter row: while the answer
 *    is held the select keeps focus and the previous answer's counts, then
 *    shows the new site's (s70b review M1: it was unmounted under the
 *    owner's hand).
 * 2. At 375 nothing passes the edge, every ⋮ is visible at rest (a touch
 *    screen has no hover: s66c's Delete was unreachable on phones), and rows
 *    stack as the design draws them: ⋮ at the end of the location's line,
 *    the location reaching it, Open beside who · when (s70b review m4,
 *    re-review N2).
 * 3. Expanding a row compares the text and reads its history once.
 * 4. Revert → Save as draft sends exactly the staging PUT's four fields and
 *    the row turns Pending in place.
 * 5. The old URL lands here.
 */

const VIEWPORT_HEIGHT = 900;
/** Sub-pixel rounding, never a real overflow. */
const EDGE_TOLERANCE = 0.5;

const CAPTURE_ROOT = path.join(
  process.cwd(),
  "docs/designs/s70-content-changes",
);
const MAX_CAPTURE_BYTES = 400 * 1024;
const MAX_CAPTURE_HEIGHT = 4_400;

/**
 * `RCF_LAYOUT_SCREENSHOTS=1` writes the evidence set into `<root>/after/`.
 * Unset, nothing is written: CI runs these as assertions only.
 */
async function capture(page: Page, name: string): Promise<void> {
  const flag = process.env.RCF_LAYOUT_SCREENSHOTS;
  if (!flag || flag === "0") return;
  const directory = path.join(CAPTURE_ROOT, "after");
  mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize();
  const image = await page.screenshot({
    type: "jpeg",
    quality: 80,
    fullPage: true,
    clip: viewport
      ? {
          x: 0,
          y: 0,
          width: viewport.width,
          height: Math.min(
            await page.evaluate(() => document.documentElement.scrollHeight),
            MAX_CAPTURE_HEIGHT,
          ),
        }
      : undefined,
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
  });
  expect(image.byteLength).toBeLessThan(MAX_CAPTURE_BYTES);
  writeFileSync(path.join(directory, `${name}.jpg`), image);
}

/**
 * The page's sideways scroll, and every visible descendant of
 * `#dashboard-main` past its right edge that no fitting overflow container
 * clips (a `truncate` label is clipped by itself, which is the point).
 */
async function measureOverflow(
  page: Page,
): Promise<{ pageOverflow: number; overflowing: string[] }> {
  return page.evaluate((tolerance) => {
    const html = document.documentElement;
    const main = document.querySelector("#dashboard-main");
    const pageOverflow = html.scrollWidth - html.clientWidth;
    if (!main) return { pageOverflow, overflowing: ["no #dashboard-main"] };
    const mainRight = main.getBoundingClientRect().right;
    const isClipped = (element: Element) => {
      for (
        let ancestor = element.parentElement;
        ancestor && ancestor !== main;
        ancestor = ancestor.parentElement
      ) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (
          overflowX !== "visible" &&
          ancestor.getBoundingClientRect().right <= mainRight + tolerance
        ) {
          return true;
        }
      }
      return false;
    };
    const overflowing = Array.from(main.querySelectorAll("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .filter(
        (element) =>
          element.getBoundingClientRect().right > mainRight + tolerance,
      )
      .filter((element) => !isClipped(element))
      .map((element) => element.tagName.toLowerCase())
      .slice(0, 10);
    return { pageOverflow, overflowing };
  }, EDGE_TOLERANCE);
}

/** The status select's options for a set of counts (ChangesFilterBar). */
function statusLabels(counts: FixtureCounts): string[] {
  const n = (value: number) => value.toLocaleString("en-US");
  return [
    `Changes (${n(counts.pending + counts.published)})`,
    `Pending (${n(counts.pending)})`,
    `Published (${n(counts.published)})`,
    `All text (${n(counts.pending + counts.published + counts.original)})`,
  ];
}

const middle = (box: { y: number; height: number }) => box.y + box.height / 2;

function rowFor(page: Page, text: string): Locator {
  return page
    .locator("li")
    .filter({ has: page.locator("[data-row-text]", { hasText: text }) });
}

test.describe("s70b Changes page", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let supabase: SupabaseClient | null = null;
  const owner = createLayoutOwnerFixture();

  test.beforeAll(async () => {
    supabase = createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E");
    await seedLayoutOwner(supabase, owner);
  });

  test.afterAll(async () => {
    if (supabase) await deleteLayoutOwner(supabase, owner);
  });

  async function openChanges(page: Page, width: number) {
    if (!supabase) throw new Error("Changes harness client is not ready.");
    const log = await routeChangesFixtures(page);
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAsLayoutOwner(page, supabase, owner, "/dashboard/changes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changes");
    await expect(rowFor(page, HERO.live)).toBeVisible();
    return log;
  }

  test("1280: two site panels, page bands, no id or selector, nothing overflows", async ({
    page,
  }) => {
    const log = await openChanges(page, 1280);

    for (const site of SITES) {
      await expect(
        page.getByRole("heading", { level: 2, name: site.name }),
      ).toBeVisible();
    }
    for (const band of ["Homepage", "Pricing", "Every page", "Changelog"]) {
      await expect(
        page.getByRole("heading", { level: 3, name: band }),
      ).toBeVisible();
    }
    // No element id the embed assigned (`rcf-1gom2eazz3g`) and no selector.
    // Matched by value: the "Every page" band's note names the author's
    // `data-rcf-id` attribute on purpose, and that is not an id.
    const text = await page.locator("#dashboard-main").innerText();
    for (const elementId of EMBED_ELEMENT_IDS) {
      expect(text).not.toContain(elementId);
    }
    for (const selector of SELECTORS) {
      expect(text).not.toContain(selector);
    }
    expect(text).not.toContain(">");
    expect(text).not.toContain(":nth-child");

    await capture(page, "changes-1280");
    const { pageOverflow, overflowing } = await measureOverflow(page);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(overflowing).toEqual([]);

    // Picking a site reloads the rows, never the filter row (s70b review M1):
    // the select was drawn from the reloading list, so it unmounted under the
    // owner's hand and came back unfocused, its status counts blanked. The
    // answer is held so the reload itself is looked at, and each site answers
    // its own counts (s70b re-review N3: with one set of counts for every
    // answer, a filter row rebuilt from nothing passed as one kept).
    const siteSelect = page.getByRole("combobox", { name: "Filter by site" });
    const statusOptions = page
      .getByRole("combobox", { name: "Filter by status" })
      .locator("option");
    await expect(statusOptions).toHaveText(statusLabels(countsFor(null)));
    const release = log.holdNextList();
    await siteSelect.focus();
    await siteSelect.selectOption(NORTHWIND_ID);
    await expect.poll(() => log.listSites).toContain(NORTHWIND_ID);

    // Reloading: the select in hand, the previous answer's counts.
    await expect(siteSelect).toBeFocused();
    await expect(siteSelect).toHaveValue(NORTHWIND_ID);
    await expect(statusOptions).toHaveText(statusLabels(countsFor(null)));

    // Answered: Northwind's rows and counts, the select still in hand.
    release();
    await expect(rowFor(page, NORTHWIND_DRAFT)).toBeVisible();
    await expect(rowFor(page, HERO.live)).toHaveCount(0);
    await expect(statusOptions).toHaveText(
      statusLabels(countsFor(NORTHWIND_ID)),
    );
    await expect(siteSelect).toBeFocused();
  });

  test("375: rows stack, every ⋮ is visible at rest, nothing overflows", async ({
    page,
  }) => {
    await openChanges(page, 375);

    const menus = page.getByRole("button", { name: /^More actions for / });
    await expect(menus).toHaveCount(7);
    for (const menu of await menus.all()) {
      await expect(menu).toBeVisible();
      expect(
        await menu.evaluate((element) => getComputedStyle(element).opacity),
      ).toBe("1");
    }

    // Stacked as the design draws it (Row anatomy, below 768): status, the
    // location and ⋮ on the first line, the location running up to ⋮; the
    // text on its own line; who · when and Open on the last line, Open at the
    // right edge under ⋮. Tombstones: Open once shared ⋮'s track and cut the
    // location to a few characters (s70b review m4); the first fix moved ⋮
    // down beside Open and cut "when" instead (s70b re-review N2).
    for (const row of await page.locator("li:has([data-row-text])").all()) {
      const gap = await row
        .locator(":scope > div")
        .first()
        .evaluate((grid) => parseFloat(getComputedStyle(grid).columnGap));
      // The row's first paragraph is its location (status is a badge).
      const location = await row.locator("p").first().boundingBox();
      const text = await row.locator("[data-row-text]").boundingBox();
      const open = await row
        .getByRole("link", { name: /^Open / })
        .boundingBox();
      const menu = await row
        .getByRole("button", { name: /^More actions for / })
        .boundingBox();
      const who = await row.locator("p:has(time)").boundingBox();
      expect(location && text && open && menu && who).toBeTruthy();

      // ⋮ ends the location's line, and the location reaches it.
      expect(Math.abs(middle(menu!) - middle(location!))).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.abs(location!.x + location!.width + gap - menu!.x),
      ).toBeLessThanOrEqual(EDGE_TOLERANCE);
      expect(text!.y).toBeGreaterThanOrEqual(
        menu!.y + menu!.height - EDGE_TOLERANCE,
      );
      // Open is on the who · when line below the text, right-aligned with ⋮,
      // and who · when ends before it.
      expect(open!.y).toBeGreaterThanOrEqual(
        text!.y + text!.height - EDGE_TOLERANCE,
      );
      expect(Math.abs(middle(open!) - middle(who!))).toBeLessThanOrEqual(1);
      expect(
        Math.abs(open!.x + open!.width - (menu!.x + menu!.width)),
      ).toBeLessThanOrEqual(EDGE_TOLERANCE);
      expect(who!.x + who!.width).toBeLessThanOrEqual(open!.x + EDGE_TOLERANCE);
    }

    await capture(page, "changes-375");
    const { pageOverflow, overflowing } = await measureOverflow(page);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(overflowing).toEqual([]);
  });

  test("expanding a row compares the text and reads its history once", async ({
    page,
  }) => {
    const log = await openChanges(page, 1280);
    const hero = rowFor(page, HERO.live);
    const toggle = hero.getByRole("button", {
      name: "Compare and history: Hero · Main heading",
    });

    await toggle.click();
    const region = hero.getByRole("region");
    await expect(region.getByText("Original", { exact: true })).toBeVisible();
    await expect(region.getByText("Live now", { exact: true })).toBeVisible();
    await expect(region.getByText(HERO.original)).toBeVisible();
    await expect(region.getByText("Draft saved")).toBeVisible();
    await capture(page, "changes-expanded-1280");

    await toggle.click();
    await toggle.click();
    await expect(region.getByText("Draft saved")).toBeVisible();
    expect(log.historyReads).toEqual([HERO.id]);
  });

  test("Revert → Save as draft sends exactly the draft, and the row turns Pending", async ({
    page,
  }) => {
    const log = await openChanges(page, 1280);
    const hero = rowFor(page, HERO.live);
    await hero
      .getByRole("button", { name: "Compare and history: Hero · Main heading" })
      .click();

    await hero.getByRole("button", { name: "Revert to original" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Revert to the original text?",
    });
    await expect(dialog).toBeVisible();
    await capture(page, "changes-revert-dialog-1280");
    await dialog.getByRole("button", { name: "Save as draft" }).click();

    await expect(dialog).toBeHidden();
    expect(log.draftBodies).toEqual([
      {
        elementId: HERO.elementId,
        content: HERO.original,
        language: HERO.language,
        variant: HERO.variant,
      },
    ]);
    expect(log.publishBodies).toEqual([]);
    const reverted = rowFor(page, HERO.original);
    await expect(reverted.getByText("Pending", { exact: true })).toBeVisible();
    await expect(page.getByText("Reverted. Saved as a draft.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dashboard/changes");
  });

  test("/dashboard/content lands on /dashboard/changes", async ({ page }) => {
    await openChanges(page, 1280);

    await page.goto("/dashboard/content");

    await page.waitForURL((url) => url.pathname === "/dashboard/changes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changes");
  });
});
