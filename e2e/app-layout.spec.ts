import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildEmbedScript } from "../src/lib/sites/embed-script";
import { createLocalServiceRoleClient } from "./support/local-supabase";
import {
  createLayoutOwnerFixture,
  deleteLayoutOwner,
  seedLayoutOwner,
  signInAsLayoutOwner,
} from "./support/owner-session";

/**
 * s66a — the app's layout, measured in a real browser.
 *
 * The owner's screenshot (2026-10-07) showed the site-registered panel with a
 * panel-level horizontal scrollbar, a tall empty band, and a Copy button
 * nobody could reach. The cause was one CSS rule: `DialogContent` was a grid,
 * a grid item keeps `min-width: auto`, and an unwrapped 300-character snippet
 * set the column to 2,524 px inside a 588 px panel (s66 research, fact 1).
 * Every unit test was green the whole time, because jsdom computes no layout.
 *
 * These tests are the proof jsdom cannot give: the two panels the owner
 * pointed at, at five widths, and the global CSS (authored border colours,
 * opaque menus, contrast, square focus) in both themes. They were written
 * first and run red against the unchanged code; see the s66a PR.
 *
 * No real token or email reaches a capture: the register response and the
 * share list are page.route fixtures, the token is 160 bullets, every address
 * is @example.com, and the site domain ends in `.invalid`.
 */

const WIDTHS = [320, 375, 768, 1280, 1920] as const;
const VIEWPORT_HEIGHT = 900;
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

/** A real snippet's length, so the fixture reproduces the owner's overflow. */
const FIXTURE_EMBED_SCRIPT = buildEmbedScript({
  siteId: ZERO_UUID,
  siteToken: "•".repeat(160),
  appUrl: "https://www.recopyfa.st",
  wsUrl: "wss://recopyfast-ws.fly.dev",
});

const LONG_LINK_LABEL =
  "Client review: homepage hero, pricing table and footer copy";

const CAPTURE_ROOT = path.join(
  process.cwd(),
  "docs/designs/s66a-app-design-tokens-and-panels",
);
const MAX_CAPTURE_BYTES = 400 * 1024;
const MAX_CAPTURE_HEIGHT = 4_400;

/**
 * `RCF_LAYOUT_SCREENSHOTS=1` writes the evidence set into `after/`;
 * `RCF_LAYOUT_SCREENSHOTS=before` writes the same set into `before/`, which is
 * how the pre-change captures were taken. Unset, nothing is written: CI runs
 * these as assertions only.
 */
function captureDirectory(): string | null {
  const flag = process.env.RCF_LAYOUT_SCREENSHOTS;
  if (!flag || flag === "0") return null;
  return path.join(CAPTURE_ROOT, flag === "before" ? "before" : "after");
}

async function capture(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const directory = captureDirectory();
  if (!directory) return;

  mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize();
  const clip =
    options.fullPage && viewport
      ? {
          x: 0,
          y: 0,
          width: viewport.width,
          height: Math.min(
            await page.evaluate(() => document.documentElement.scrollHeight),
            MAX_CAPTURE_HEIGHT,
          ),
        }
      : undefined;
  const image = await page.screenshot({
    type: "jpeg",
    quality: 80,
    fullPage: options.fullPage ?? false,
    clip,
    animations: "disabled",
    // `next dev` floats its dev-tools badge over the page; `next start` (CI)
    // has none. Hidden so a local capture shows only the product.
    style: "nextjs-portal { display: none !important; }",
  });
  expect(image.byteLength).toBeLessThan(MAX_CAPTURE_BYTES);
  writeFileSync(path.join(directory, `${name}.jpg`), image);
}

interface DialogMeasurement {
  /** `documentElement.scrollWidth - clientWidth`. */
  pageOverflow: number;
  /** The dialog's own `scrollWidth - clientWidth`. */
  dialogOverflow: number;
  /** Visible descendants whose right edge passes the dialog's. */
  overflowingDescendants: string[];
  /**
   * Elements in the dialog (itself included) whose computed `overflow-y` is
   * `auto` or `scroll`. Form controls are not counted: an <input> or
   * <select> is its own internal scroller in Chromium, not a layout region.
   */
  scrollContainers: number;
  /** The title's top, measured from the dialog's top. */
  titleOffset: number | null;
  titleText: string | null;
  /** Whether a "Copy" button exists and sits fully inside the dialog. */
  copyButtonInside: boolean | null;
  /** The first <pre>'s `scrollWidth - clientWidth` (a wrapped snippet is 0). */
  snippetOverflow: number | null;
  /** NativeSelect: select right edge minus chevron right edge. */
  chevronInset: number | null;
  /** The select's right padding minus the chevron's footprint (≥ 0). */
  chevronClearance: number | null;
}

async function measureDialog(page: Page): Promise<DialogMeasurement> {
  return page.getByRole("dialog").evaluate((dialog) => {
    const dialogRect = dialog.getBoundingClientRect();
    const html = document.documentElement;
    const FORM_CONTROLS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

    const describe = (element: Element) => {
      const className =
        typeof element.className === "string"
          ? element.className.split(/\s+/).slice(0, 4).join(".")
          : "";
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };

    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    };

    const all = [dialog, ...Array.from(dialog.querySelectorAll("*"))];

    const overflowingDescendants = all
      .filter((element) => element !== dialog && isVisible(element))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > dialogRect.right + 0.5,
      )
      .map(describe)
      .slice(0, 10);

    const scrollContainers = all.filter((element) => {
      if (FORM_CONTROLS.has(element.tagName)) return false;
      const overflowY = getComputedStyle(element).overflowY;
      return overflowY === "auto" || overflowY === "scroll";
    }).length;

    const title = dialog.querySelector("h2");
    const titleOffset = title
      ? title.getBoundingClientRect().top - dialogRect.top
      : null;

    const copyButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Copy",
    );
    let copyButtonInside: boolean | null = null;
    if (copyButton) {
      const rect = copyButton.getBoundingClientRect();
      copyButtonInside =
        rect.left >= dialogRect.left - 0.5 &&
        rect.right <= dialogRect.right + 0.5 &&
        rect.top >= dialogRect.top - 0.5 &&
        rect.bottom <= dialogRect.bottom + 0.5;
    }

    const snippet = dialog.querySelector("pre");
    const snippetOverflow = snippet
      ? snippet.scrollWidth - snippet.clientWidth
      : null;

    const select = dialog.querySelector("select");
    const chevron = select?.parentElement?.querySelector("svg") ?? null;
    let chevronInset: number | null = null;
    let chevronClearance: number | null = null;
    if (select && chevron) {
      const selectRect = select.getBoundingClientRect();
      const chevronRect = chevron.getBoundingClientRect();
      chevronInset = selectRect.right - chevronRect.right;
      chevronClearance =
        parseFloat(getComputedStyle(select).paddingRight) -
        (selectRect.right - chevronRect.left);
    }

    return {
      pageOverflow: html.scrollWidth - html.clientWidth,
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      overflowingDescendants,
      scrollContainers,
      titleOffset,
      titleText: title?.textContent?.trim() ?? null,
      copyButtonInside,
      snippetOverflow,
      chevronInset,
      chevronClearance,
    };
  });
}

/** Asserts the layout contract both panels share (AC 1 and AC 2). */
function expectContainedDialog(measurement: DialogMeasurement): void {
  expect(measurement.pageOverflow).toBeLessThanOrEqual(0);
  expect(measurement.dialogOverflow).toBeLessThanOrEqual(0);
  expect(measurement.overflowingDescendants).toEqual([]);
  expect(measurement.scrollContainers).toBe(1);
  expect(measurement.titleOffset).not.toBeNull();
  expect(measurement.titleOffset as number).toBeLessThan(120);
}

async function routeRegistration(page: Page): Promise<void> {
  await page.route("**/api/sites/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        site: {
          id: ZERO_UUID,
          domain: "example.com",
          name: "Example site",
          created_at: "2026-10-08T00:00:00.000Z",
        },
        apiKey: "•••",
        siteToken: "•".repeat(160),
        embedScript: FIXTURE_EMBED_SCRIPT,
      }),
    });
  });
}

async function routeShareList(page: Page): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  await page.route(
    (url) => url.pathname === "/api/staging/access",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          accessList: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              type: "invite",
              email: "reviewer.pending@example.com",
              emailVerified: false,
              permissions: ["view", "edit"],
              label: LONG_LINK_LABEL,
              expiresAt: new Date(now + 6 * day).toISOString(),
              isActive: true,
              lastUsedAt: null,
              createdAt: new Date(now - day).toISOString(),
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              type: "invite",
              email: "reviewer.expired@example.com",
              emailVerified: true,
              permissions: ["view"],
              label: null,
              expiresAt: new Date(now - 2 * day).toISOString(),
              isActive: true,
              lastUsedAt: new Date(now - 3 * day).toISOString(),
              createdAt: new Date(now - 9 * day).toISOString(),
            },
          ],
        }),
      });
    },
  );
}

async function openShareDialog(page: Page): Promise<Locator> {
  await page.locator('button[title="Share preview link"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(LONG_LINK_LABEL)).toBeVisible();
  return dialog;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgb {
  const channels = value.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (value.startsWith("color(srgb")) {
    const [r = 0, g = 0, b = 0, a = 1] = channels;
    return { r: r * 255, g: g * 255, b: b * 255, a };
  }
  const [r = 0, g = 0, b = 0, a = 1] = channels;
  return { r, g, b, a };
}

function luminance({ r, g, b }: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(parseColor(foreground));
  const b = luminance(parseColor(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Resolves a custom property to the colour Chromium computes for it here. */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

/**
 * Moves focus onto `target` with the keyboard, so `:focus-visible` matches
 * the way it does for a keyboard user (a programmatic `.focus()` after a
 * pointer click would not).
 */
async function focusWithKeyboard(page: Page, target: Locator): Promise<void> {
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

interface FocusGeometry {
  indicatorWidth: number;
  maxRadius: number;
}

async function measureFocus(target: Locator): Promise<FocusGeometry> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const outline =
      style.outlineStyle !== "none" ? parseFloat(style.outlineWidth) : 0;
    // A Tailwind `ring-2` is a 2px box-shadow spread: `… 0px 0px 0px 2px`
    // (with the offset ring underneath it at a larger spread).
    const spreads = Array.from(
      style.boxShadow.matchAll(/0px 0px 0px (\d+(?:\.\d+)?)px/g),
    ).map((match) => Number(match[1]));
    const ring = spreads.length > 0 ? Math.min(...spreads) : 0;
    const radii = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((radius) => parseFloat(radius) || 0);
    return {
      indicatorWidth: Math.max(outline, ring),
      maxRadius: Math.max(...radii),
    };
  });
}

async function expectSquareFocus(page: Page, target: Locator): Promise<void> {
  await focusWithKeyboard(page, target);
  const geometry = await measureFocus(target);
  expect(geometry.indicatorWidth).toBeGreaterThanOrEqual(2);
  expect(geometry.maxRadius).toBeLessThanOrEqual(2);
}

async function applyTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

test.describe("s66a app layout harness", () => {
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
    if (!supabase) throw new Error("Layout harness client is not ready.");
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAsLayoutOwner(page, supabase, owner);
  }

  for (const width of WIDTHS) {
    test(`site-registered panel @${width}`, async ({ page }) => {
      await routeRegistration(page);
      await signIn(page, width);

      await page.getByRole("button", { name: "Add site" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // The form state is a <form> spanning body and footer: the case where a
      // body that is not a direct flex child silently loses its scroll region.
      const formState = await measureDialog(page);
      expect(formState.scrollContainers).toBe(1);

      await dialog.getByLabel(/Website Name/).fill("Example site");
      await dialog.getByLabel(/Website URL/).fill("example.com");
      await dialog.getByRole("button", { name: "Register Site" }).click();
      await expect(dialog.getByText(/data-site-token=/)).toBeVisible();

      await capture(page, `site-registered-${width}`);
      const measurement = await measureDialog(page);

      expectContainedDialog(measurement);
      expect(measurement.titleText).toBe("Site registered");
      expect(measurement.snippetOverflow).toBe(0);
      expect(measurement.copyButtonInside).toBe(true);
    });
  }

  for (const width of WIDTHS) {
    test(`share preview link @${width}`, async ({ page }) => {
      await routeShareList(page);
      await signIn(page, width);

      await openShareDialog(page);
      await capture(page, `share-preview-link-${width}`);
      const measurement = await measureDialog(page);

      expectContainedDialog(measurement);
      expect(measurement.titleText).toBe("Share preview link");
      expect(measurement.chevronInset).not.toBeNull();
      expect(Math.abs((measurement.chevronInset as number) - 12)).toBeLessThan(
        1.01,
      );
      expect(measurement.chevronClearance as number).toBeGreaterThanOrEqual(0);
    });
  }

  /**
   * The dashboard pages the border-layer move repaints (plan "where this could
   * be wrong" 2), captured first so a red run still leaves its evidence.
   */
  async function captureDashboardPages(page: Page): Promise<void> {
    if (!captureDirectory()) return;
    for (const [route, name] of [
      ["/dashboard", "dashboard-1280"],
      ["/dashboard/sites", "sites-1280"],
      ["/dashboard/settings", "settings-1280"],
      ["/dashboard/billing", "billing-1280"],
    ] as const) {
      await page.goto(route);
      await applyTheme(page, "dark");
      await page.waitForLoadState("networkidle");
      await capture(page, name, { fullPage: true });
    }
  }

  test("app CSS: borders, popover, contrast, focus", async ({ page }) => {
    await routeShareList(page);
    await signIn(page, 1280);
    await captureDashboardPages(page);

    for (const theme of ["dark", "light"] as const) {
      await page.goto("/dashboard/sites");
      await applyTheme(page, theme);
      await expect(
        page.locator('button[title="Share preview link"]').first(),
      ).toBeVisible();

      // AC 4b: the sort menu is opaque.
      await page.getByRole("button", { name: /^Sort sites/ }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const menuBackground = await menu.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(menuBackground).not.toBe("rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      const dialog = await openShareDialog(page);
      const lineStrong = await resolveToken(page, "--line-strong");
      const surfaceCard = await resolveToken(page, "--surface-card");

      // AC 4a: the authored `border-input` beats the reset. Measured on an
      // input at rest: the dialog focuses the email field on open, and a
      // focused input rightly draws `border-ring` instead.
      const email = dialog.getByLabel("Email address", { exact: false });
      // The pointer is parked off the controls (no hover colour), and the
      // read is polled because the border colour animates for 200ms.
      const restingInput = dialog.getByLabel("Label (optional)");
      await expect(restingInput).not.toBeFocused();
      await page.mouse.move(1, 1);
      const readBorder = () =>
        restingInput.evaluate(
          (element) => getComputedStyle(element).borderTopColor,
        );
      await expect.poll(readBorder).toBe(lineStrong);
      const inputBorder = await readBorder();
      expect(contrast(inputBorder, surfaceCard)).toBeGreaterThanOrEqual(3);

      // AC 7: body and muted text on the dialog surface.
      const dialogBackground = await dialog.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const bodyText = await dialog
        .getByText("Permissions", { exact: true })
        .evaluate((element) => getComputedStyle(element).color);
      const mutedText = await dialog
        .getByText(/Create a shareable link/)
        .evaluate((element) => getComputedStyle(element).color);
      expect(contrast(bodyText, dialogBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mutedText, dialogBackground)).toBeGreaterThanOrEqual(4.5);

      // AC 7: keyboard focus is a 2px indicator on a square control.
      await expectSquareFocus(page, email);
      await expectSquareFocus(page, dialog.getByLabel("Expires in"));
      await expectSquareFocus(
        page,
        dialog.getByRole("button", { name: "Cancel" }),
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await page.goto("/dashboard/settings");
      await applyTheme(page, theme);
      const firstTab = page.getByRole("tab").first();
      await expect(firstTab).toBeVisible();
      await expectSquareFocus(page, firstTab);
    }
  });
});
