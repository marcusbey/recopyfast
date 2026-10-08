import { expect, test, type Page, type Request } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLocalServiceRoleClient } from "./support/local-supabase";
import {
  createLayoutOwnerFixture,
  deleteLayoutOwner,
  seedLayoutOwner,
  signInAsLayoutOwner,
} from "./support/owner-session";
import {
  LONG_LINK_LABEL,
  routeShareList,
  routeSites,
  routeSitesWithFixtureCredentials,
} from "./support/site-fixtures";

/**
 * s66c1 — a site has its own pages (ADR 052), measured in a real browser.
 *
 * Before s66c1 a site had no URL: "View Details" swapped the Sites page for
 * an 11-card view held in component state, so Back left the dashboard and
 * nothing could be linked to. Delete sat behind a hover-only ⋮ that a touch
 * screen cannot open. jsdom computes no layout and has no history, so these
 * are the proofs it cannot give, on the s66a signed-in harness (a throwaway
 * owner and site on the disposable local stack):
 * - Back and Forward walk the subpages, and Back from a site returns to Sites;
 * - no page scrolls sideways and nothing inside the content column passes its
 *   right edge, on the list and on each subpage, at 375 and 1280;
 * - Delete is reached by taps alone;
 * - the preview-link list holds a 60-character label, and the Add editor
 *   dialog has one scroll region;
 * - moving from one site to another never shows the first site's token
 *   (the layout's `key`, ADR 052 "Watch").
 *
 * No real token or address reaches a capture: `GET /api/sites` passes through
 * with its install credentials replaced by bullets, the preview links are a
 * `page.route` fixture at @example.com, and the seeded domain is `.invalid`.
 */

const VIEWPORT_HEIGHT = 900;
const NAV_WIDTHS = [375, 1280] as const;
const SITE_NAME = "E2E layout site";
/** Sub-pixel rounding, never a real overflow. */
const EDGE_TOLERANCE = 0.5;
/** The provider polls an awaiting-install site every 5 s; the list never. */
const LONGER_THAN_ONE_POLL_MS = 6_000;

const CAPTURE_ROOT = path.join(
  process.cwd(),
  "docs/designs/s66c-site-page-and-access",
);
const MAX_CAPTURE_BYTES = 400 * 1024;
const MAX_CAPTURE_HEIGHT = 4_400;

/**
 * `RCF_LAYOUT_SCREENSHOTS=1` writes the evidence set into `<root>/after/`
 * (`before` into `<root>/before/`). Unset, nothing is written: CI runs these
 * as assertions only.
 */
async function capture(page: Page, name: string): Promise<void> {
  const flag = process.env.RCF_LAYOUT_SCREENSHOTS;
  if (!flag || flag === "0") return;
  const directory = path.join(
    CAPTURE_ROOT,
    flag === "before" ? "before" : "after",
  );
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

interface ContentOverflow {
  /** `documentElement.scrollWidth - clientWidth`. */
  pageOverflow: number;
  /** Visible descendants of `#dashboard-main` past its right edge. */
  overflowing: string[];
}

/**
 * A descendant clipped by a scroll or overflow container that itself fits
 * (a wide table in `overflow-x-auto`, a `truncate` label) is not past the
 * edge anyone sees, so it does not count.
 */
async function measureContent(page: Page): Promise<ContentOverflow> {
  return page.evaluate((tolerance) => {
    const html = document.documentElement;
    const main = document.querySelector("#dashboard-main");
    const pageOverflow = html.scrollWidth - html.clientWidth;
    if (!main) return { pageOverflow, overflowing: ["no #dashboard-main"] };

    const mainRight = main.getBoundingClientRect().right;
    const describe = (element: Element) => {
      const className =
        typeof element.className === "string"
          ? element.className.split(/\s+/).slice(0, 4).join(".")
          : "";
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    };
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
      .filter(isVisible)
      .filter(
        (element) =>
          element.getBoundingClientRect().right > mainRight + tolerance,
      )
      .filter((element) => !isClipped(element))
      .map(describe)
      .slice(0, 10);

    return { pageOverflow, overflowing };
  }, EDGE_TOLERANCE);
}

test.describe("s66c1 site pages", () => {
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

  async function signIn(page: Page, width: number): Promise<void> {
    if (!supabase) throw new Error("Site pages client is not ready.");
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAsLayoutOwner(page, supabase, owner);
  }

  const sitePath = (segment = "") =>
    `/dashboard/sites/${owner.siteId}${segment ? `/${segment}` : ""}`;

  async function expectOn(page: Page, pathname: string, title: string) {
    await page.waitForURL((url) => url.pathname === pathname);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }

  for (const width of NAV_WIDTHS) {
    test(`site pages walk with Back and Forward @${width}`, async ({
      page,
    }) => {
      await signIn(page, width);
      await expectOn(page, "/dashboard/sites", "Sites");

      await page.getByRole("link", { name: SITE_NAME, exact: true }).click();
      await expectOn(page, sitePath(), SITE_NAME);

      const siteNav = page.getByRole("navigation", { name: "Site" });
      await siteNav.getByRole("link", { name: "Install" }).click();
      await expectOn(page, sitePath("install"), SITE_NAME);
      await expect(
        siteNav.getByRole("link", { name: "Install" }),
      ).toHaveAttribute("aria-current", "page");

      await siteNav.getByRole("link", { name: "People & access" }).click();
      await expectOn(page, sitePath("people"), SITE_NAME);

      await page.goBack();
      await expectOn(page, sitePath("install"), SITE_NAME);
      await page.goBack();
      await expectOn(page, sitePath(), SITE_NAME);
      await page.goForward();
      await expectOn(page, sitePath("install"), SITE_NAME);
      await page.goBack();
      await expectOn(page, sitePath(), SITE_NAME);

      // Back from a site's Overview is the Sites list, not out of the app.
      await page.goBack();
      await expectOn(page, "/dashboard/sites", "Sites");
    });
  }

  test("an id the account does not have is Site not found", async ({
    page,
  }) => {
    await signIn(page, 1280);

    await page.goto(`/dashboard/sites/${randomUUID()}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Site not found",
    );
    await expect(
      page.getByRole("link", { name: "Back to Sites" }),
    ).toHaveAttribute("href", "/dashboard/sites");
    await expect(page.getByText(SITE_NAME)).toHaveCount(0);
  });

  for (const width of NAV_WIDTHS) {
    test(`Sites and the four subpages fit @${width}`, async ({ page }) => {
      await routeSitesWithFixtureCredentials(page);
      await routeShareList(page);
      const sitesRequests: Request[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname === "/api/sites"
        ) {
          sitesRequests.push(request);
        }
      });
      await signIn(page, width);

      const pages: Array<[string, string, string]> = [
        ["/dashboard/sites", "Sites", "sites"],
        [sitePath(), SITE_NAME, "overview"],
        [sitePath("install"), SITE_NAME, "install"],
        [sitePath("people"), SITE_NAME, "people"],
        [sitePath("settings"), SITE_NAME, "settings"],
      ];
      const violations: string[] = [];
      for (const [pathname, title, name] of pages) {
        await page.goto(pathname);
        await expectOn(page, pathname, title);
        await page.waitForLoadState("networkidle");
        await capture(page, `${name}-${width}`);
        const { pageOverflow, overflowing } = await measureContent(page);
        if (pageOverflow > 0) {
          violations.push(
            `${name} @${width}: page scrolls by ${pageOverflow}px`,
          );
        }
        violations.push(
          ...overflowing.map(
            (element) =>
              `${name} @${width}: ${element} passes the content edge`,
          ),
        );
      }
      expect(violations).toEqual([]);

      // Poll ownership (ADR 052): the list reads `GET /api/sites` once and
      // never polls; only a site's own pages poll, while it awaits install.
      await page.goto("/dashboard/sites");
      await expectOn(page, "/dashboard/sites", "Sites");
      await page.waitForLoadState("networkidle");
      const listRequests = sitesRequests.length;
      await page.waitForTimeout(LONGER_THAN_ONE_POLL_MS);
      expect(sitesRequests.length).toBe(listRequests);
    });
  }

  test.describe("by touch", () => {
    test.use({ hasTouch: true });

    test("Delete is reached by taps alone @375", async ({ page }) => {
      let deleteRequests = 0;
      // Fulfilled here, so the seeded site survives for the tests after this.
      await page.route(
        (url) => url.pathname === `/api/sites/${owner.siteId}`,
        async (route) => {
          if (route.request().method() !== "DELETE") return route.continue();
          deleteRequests += 1;
          await route.fulfill({ status: 200, json: { success: true } });
        },
      );
      await signIn(page, 375);
      await expectOn(page, "/dashboard/sites", "Sites");

      const menu = page.getByRole("button", {
        name: `Open menu for ${SITE_NAME}`,
      });
      // Visible at rest: no hover exists on a touch screen.
      await expect(menu).toBeVisible();
      await menu.tap();
      await page.getByRole("menuitem", { name: "Delete site" }).tap();
      const dialog = page.getByRole("dialog", { name: "Delete site?" });
      await expect(dialog).toBeVisible();
      await capture(page, "delete-site-375");
      await dialog.getByRole("button", { name: "Delete site" }).tap();

      await expect(dialog).toBeHidden();
      expect(deleteRequests).toBe(1);
      expect(new URL(page.url()).pathname).toBe("/dashboard/sites");
      await expect(
        page.getByRole("link", { name: SITE_NAME, exact: true }),
      ).toHaveCount(0);
    });
  });

  test("the preview-link list holds a 60-character label @375", async ({
    page,
  }) => {
    await routeSitesWithFixtureCredentials(page);
    await routeShareList(page);
    await signIn(page, 375);

    await page.goto(sitePath("people"));
    await expectOn(page, sitePath("people"), SITE_NAME);
    await expect(page.getByText(LONG_LINK_LABEL)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Preview links · 2" }),
    ).toBeVisible();

    const { pageOverflow, overflowing } = await measureContent(page);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    expect(overflowing).toEqual([]);
  });

  test("the Add editor dialog has exactly one scroll region @375", async ({
    page,
  }) => {
    await routeSitesWithFixtureCredentials(page);
    await signIn(page, 375);

    await page.goto(sitePath("people"));
    await expectOn(page, sitePath("people"), SITE_NAME);
    await page
      .getByRole("region", { name: "Give someone access" })
      .getByRole("button", { name: "Add editor" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Editor email")).toBeVisible();
    await capture(page, "add-editor-375");

    const layout = await dialog.evaluate((element) => {
      const FORM_CONTROLS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
      const all = [element, ...Array.from(element.querySelectorAll("*"))];
      const rect = element.getBoundingClientRect();
      return {
        scrollContainers: all.filter((node) => {
          if (FORM_CONTROLS.has(node.tagName)) return false;
          const overflowY = getComputedStyle(node).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        }).length,
        dialogOverflow: element.scrollWidth - element.clientWidth,
        pastRight: all.filter(
          (node) => node.getBoundingClientRect().right > rect.right + 0.5,
        ).length,
      };
    });
    expect(layout.scrollContainers).toBe(1);
    expect(layout.dialogOverflow).toBeLessThanOrEqual(0);
    expect(layout.pastRight).toBe(0);
  });

  /**
   * ADR 052 "Watch", in a browser: the layout keys the provider by site, so
   * moving from site A to site B remounts it. Site A's token must not appear
   * on any of site B's pages, at any point the test can see.
   *
   * Every move is a click on an in-app link (s66c1 review m7), the way an
   * owner moves: the router, not a fresh document, decides what stays
   * mounted. It used to `page.goto` the list, a full load that builds a new
   * provider whatever the router would have kept, so it could not see a
   * client-side remount problem at all. A marker on `window` proves no move
   * reloaded the page. The `key` itself is proved in Jest (SiteProvider.test,
   * "shows none of the first site's token in the render that switches
   * sites").
   */
  test("moving from one site to another never shows the first site's token", async ({
    page,
  }) => {
    const siteA = {
      id: randomUUID(),
      name: "Fixture site A",
      domain: "site-a.invalid",
      siteToken: "fixture-token-for-site-a",
    };
    const siteB = {
      id: randomUUID(),
      name: "Fixture site B",
      domain: "site-b.invalid",
      siteToken: "fixture-token-for-site-b",
    };
    await routeSites(page, [siteA, siteB]);
    await signIn(page, 1280);
    await expectOn(page, "/dashboard/sites", "Sites");
    await page.evaluate(() => {
      (window as Window & { __rcfSameDocument?: boolean }).__rcfSameDocument =
        true;
    });
    const tokenA = page.getByText(siteA.siteToken, { exact: true });

    await page.getByRole("link", { name: siteA.name, exact: true }).click();
    await expectOn(page, `/dashboard/sites/${siteA.id}`, siteA.name);
    await page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Install" })
      .click();
    await expectOn(page, `/dashboard/sites/${siteA.id}/install`, siteA.name);
    await expect(tokenA).toBeVisible();

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Sites", exact: true })
      .click();
    await expectOn(page, "/dashboard/sites", "Sites");
    await page.getByRole("link", { name: siteB.name, exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === `/dashboard/sites/${siteB.id}`,
    );
    await expect(tokenA).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      siteB.name,
    );

    await page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Install" })
      .click();
    await expectOn(page, `/dashboard/sites/${siteB.id}/install`, siteB.name);
    await expect(
      page.getByText(siteB.siteToken, { exact: true }),
    ).toBeVisible();
    await expect(tokenA).toHaveCount(0);

    expect(
      await page.evaluate(
        () =>
          (window as Window & { __rcfSameDocument?: boolean })
            .__rcfSameDocument === true,
      ),
    ).toBe(true);
  });
});
