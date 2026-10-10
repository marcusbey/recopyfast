import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildEmbedScript } from "../src/lib/sites/embed-script";
import { focusIndicatorWidth } from "./support/focus-indicator";
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

/** Exactly 60 characters, as AC 2 specifies. */
const LONG_LINK_LABEL =
  "Client review: homepage hero, pricing tables and footer copy";

/**
 * Each story writes its evidence beside its own design doc, so a later
 * story's captures never overwrite the set an earlier review judged.
 */
const S66A_CAPTURE_ROOT = path.join(
  process.cwd(),
  "docs/designs/s66a-app-design-tokens-and-panels",
);
const S66B_CAPTURE_ROOT = path.join(
  process.cwd(),
  "docs/designs/s66b-app-page-layout",
);
const MAX_CAPTURE_BYTES = 400 * 1024;
const MAX_CAPTURE_HEIGHT = 4_400;

/**
 * `RCF_LAYOUT_SCREENSHOTS=1` writes the evidence set into `<root>/after/`;
 * `RCF_LAYOUT_SCREENSHOTS=before` writes the same set into `<root>/before/`,
 * which is how the pre-change captures were taken. Unset, nothing is written:
 * CI runs these as assertions only.
 */
function captureDirectory(root: string): string | null {
  const flag = process.env.RCF_LAYOUT_SCREENSHOTS;
  if (!flag || flag === "0") return null;
  return path.join(root, flag === "before" ? "before" : "after");
}

async function capture(
  root: string,
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const directory = captureDirectory(root);
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

/**
 * s66c1: the dialog is create-only and opens from the site's People & access
 * page, where the links it used to list now are. The 60-character label is
 * therefore checked on that page's list, before the dialog opens.
 */
async function openShareDialog(page: Page, siteId: string): Promise<Locator> {
  await page.goto(`/dashboard/sites/${siteId}/people`);
  await expect(page.getByText(LONG_LINK_LABEL)).toBeVisible();
  await page
    .getByRole("region", { name: "Give someone access" })
    .getByRole("button", { name: "Share preview link" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
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

/**
 * The outline or the ring, whichever is wider, read from the computed style
 * strings by `focusIndicatorWidth` (unit-tested: the first version of this
 * check took the smallest shadow spread, which Tailwind's unused `0px` layers
 * always made 0, so the ring never counted — s66a review m2).
 */
async function measureFocus(target: Locator): Promise<FocusGeometry> {
  const { focus, radii } = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focus: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
      },
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((radius) => parseFloat(radius) || 0),
    };
  });
  return {
    indicatorWidth: focusIndicatorWidth(focus),
    maxRadius: Math.max(...radii),
  };
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

      await capture(S66A_CAPTURE_ROOT, page, `site-registered-${width}`);
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

      await openShareDialog(page, owner.siteId);
      await capture(S66A_CAPTURE_ROOT, page, `share-preview-link-${width}`);
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
    if (!captureDirectory(S66A_CAPTURE_ROOT)) return;
    for (const [route, name] of [
      ["/dashboard", "dashboard-1280"],
      ["/dashboard/sites", "sites-1280"],
      ["/dashboard/settings", "settings-1280"],
      ["/dashboard/billing", "billing-1280"],
    ] as const) {
      await page.goto(route);
      await applyTheme(page, "dark");
      await page.waitForLoadState("networkidle");
      await capture(S66A_CAPTURE_ROOT, page, name, { fullPage: true });
    }
  }

  test("app CSS: borders, popover, contrast, focus", async ({ page }) => {
    await routeShareList(page);
    await signIn(page, 1280);
    await captureDashboardPages(page);

    for (const theme of ["dark", "light"] as const) {
      await page.goto("/dashboard/sites");
      await applyTheme(page, theme);
      // s66c1: the share icon moved into the row's menu, which is visible at
      // rest (no hover on touch).
      await expect(
        page.getByRole("button", { name: "Open menu for E2E layout site" }),
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

      const dialog = await openShareDialog(page, owner.siteId);
      await applyTheme(page, theme);
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
        .getByText(/For a one-off review of unpublished changes/)
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

/* -------------------------------------------------------------------------
 * s66b1 — one frame, one title, one left edge (ADR 053).
 *
 * Before s66b1 every app page titled itself: `.text-display` on Overview,
 * a 30/700 h1 on Content and Settings, an h2 and no h1 at all on Analytics,
 * and a second `container mx-auto px-4` on Billing that put its title 16 px
 * right of every other page. Each was a convention nobody had to follow, and
 * jsdom could not have caught any of it: it computes no layout. These tests
 * measure the frame in a real browser at the four widths the owner asked
 * for. "One left edge" is the contract the whole story turns on, so it is
 * measured on every direct child of `[data-page-shell]`, not only on the h1.
 * ---------------------------------------------------------------------- */

const APP_PAGE_WIDTHS = [375, 768, 1280, 1920] as const;
type AppPageWidth = (typeof APP_PAGE_WIDTHS)[number];

/** Header and sidebar brand row are one 56 px band (design system, Shell). */
const APP_HEADER_HEIGHT = 56;
/** The layout's gutter at ≥1024 (`lg:px-8`). */
const WIDE_GUTTER = 32;
const SIDEBAR_BREAKPOINT = 1024;
/** Tailwind's `sm`: where the shell's gap and the header's layout change. */
const SM_BREAKPOINT = 640;
/**
 * `PageShell`'s rhythm (design system, Shell): header to first section, 24px
 * from 640 up and 16px below.
 */
const SHELL_GAP = { narrow: 16, wide: 24 } as const;
/** Sub-pixel rounding, never a real misalignment. */
const EDGE_TOLERANCE = 0.5;
const CONTRAST_WIDTH: AppPageWidth = 1280;
const MIN_TEXT_CONTRAST = 4.5;

/**
 * The content's left edge, from the 256 px sidebar and the 16 / 24 / 32
 * gutters. 1920 has no constant: the 1180 px column centres in whatever width
 * the scrollbar leaves (530 with overlay scrollbars, 522.5 with a classic
 * 15 px one), so its edge is read from `main` instead.
 */
const EXPECTED_CONTENT_LEFT: Record<AppPageWidth, number | "main"> = {
  375: 16,
  768: 24,
  1280: 288,
  1920: "main",
};

interface AppPage {
  path: string;
  /** Capture file stem. */
  name: string;
  /** The sidebar item that carries `aria-current="page"` on this route. */
  navLabel: string;
  /** The page's description, rendered by `PageShell` under the h1. */
  description: string;
  /**
   * Renders header actions in every state the harness can meet, so their
   * absence is a failure. Billing has them in its ready state only; where
   * they render, they are checked all the same.
   */
  hasActions: boolean;
}

const APP_PAGES: readonly AppPage[] = [
  {
    path: "/dashboard",
    name: "overview",
    navLabel: "Overview",
    description: "Every site you have connected, and what has changed on them.",
    hasActions: true,
  },
  {
    // s70b: the Content page became Changes (/dashboard/content redirects).
    path: "/dashboard/changes",
    name: "changes",
    navLabel: "Changes",
    description: "What changed on your sites, page by page.",
    hasActions: false,
  },
  {
    path: "/dashboard/analytics",
    name: "analytics",
    navLabel: "Analytics",
    description: "Monitor your site performance and user engagement",
    hasActions: true,
  },
  {
    path: "/dashboard/settings",
    name: "settings",
    navLabel: "Settings",
    description: "Manage your account and preferences",
    hasActions: false,
  },
  {
    path: "/dashboard/billing",
    name: "billing",
    navLabel: "Billing",
    description:
      "Manage your subscription, payment methods, and billing information",
    hasActions: false,
  },
];

/** Never the current page on any route above, so always an inactive item. */
const INACTIVE_NAV_LABEL = "Sites";

interface HeadingMeasurement {
  text: string;
  left: number;
  fontSize: string;
  fontWeight: string;
  insidePageHeader: boolean;
}

interface FrameMeasurement {
  headerHeight: number | null;
  headerBottom: number | null;
  /** The sidebar brand row's bottom (the sidebar is off-canvas below 1024). */
  brandBottom: number | null;
  /** `documentElement.scrollWidth - clientWidth`. */
  pageOverflow: number;
  /** Every visible h1 in the document. */
  headings: HeadingMeasurement[];
  /** `main`'s left plus the ≥1024 gutter. */
  mainContentLeft: number | null;
  /**
   * The visible element children of `[data-page-shell]`, or null when no
   * shell exists. "Visible" is wider than 1 px and taller than 0: it drops
   * exactly what is not a section — a closed dialog root renders nothing or
   * portals to <body>, a live region or `sr-only` node is at most 1 px, and
   * a banner that renders `null` is not an element at all.
   */
  shellChildren: Array<{ element: string; left: number }> | null;
  /**
   * `[data-page-header]`'s bottom to the top of the first visible section
   * after it: the shell's gap as drawn. Null without a header or a section.
   */
  headerToFirstSection: number | null;
  /**
   * `PageHeader`'s grid areas, found by name (`grid-row-start` computes to
   * the area's name), so the check reads the header's own layout contract
   * rather than its class list. Null for an area the page does not render.
   */
  headerAreas: {
    title: { top: number; bottom: number } | null;
    description: { top: number; bottom: number } | null;
    actions: { top: number; bottom: number } | null;
  };
}

async function measureFrame(page: Page): Promise<FrameMeasurement> {
  return page.evaluate((gutter) => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    };
    const describe = (element: Element) => {
      const className =
        typeof element.className === "string"
          ? element.className.split(/\s+/).slice(0, 3).join(".")
          : "";
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };

    const html = document.documentElement;
    const header = document.querySelector("[data-app-header]");
    const brand = document.querySelector("[data-sidebar-brand]");
    const main = document.querySelector("main");
    const shell = document.querySelector("[data-page-shell]");

    const headings = Array.from(document.querySelectorAll("h1"))
      .filter(isVisible)
      .map((heading) => {
        const style = getComputedStyle(heading);
        return {
          text: heading.textContent?.trim() ?? "",
          left: heading.getBoundingClientRect().left,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          insidePageHeader: heading.closest("[data-page-header]") !== null,
        };
      });

    const isSection = (child: Element) =>
      isVisible(child) && child.getBoundingClientRect().width > 1;

    const shellChildren = shell
      ? Array.from(shell.children)
          .filter(isSection)
          .map((child) => ({
            element: describe(child),
            left: child.getBoundingClientRect().left,
          }))
      : null;

    const pageHeader = shell?.querySelector(":scope > [data-page-header]");
    const firstSection = pageHeader
      ? Array.from(shell?.children ?? [])
          .slice(Array.from(shell?.children ?? []).indexOf(pageHeader) + 1)
          .find(isSection)
      : undefined;
    const headerToFirstSection =
      pageHeader && firstSection
        ? firstSection.getBoundingClientRect().top -
          pageHeader.getBoundingClientRect().bottom
        : null;

    const area = (name: string) => {
      const element = pageHeader
        ? Array.from(pageHeader.children).find(
            (child) =>
              isVisible(child) && getComputedStyle(child).gridRowStart === name,
          )
        : undefined;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };

    return {
      headerHeight: header ? header.getBoundingClientRect().height : null,
      headerBottom: header ? header.getBoundingClientRect().bottom : null,
      brandBottom: brand ? brand.getBoundingClientRect().bottom : null,
      pageOverflow: html.scrollWidth - html.clientWidth,
      headings,
      mainContentLeft: main ? main.getBoundingClientRect().left + gutter : null,
      shellChildren,
      headerToFirstSection,
      headerAreas: {
        title: area("title"),
        description: area("description"),
        actions: area("actions"),
      },
    };
  }, WIDE_GUTTER);
}

const isNear = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= EDGE_TOLERANCE;

/**
 * Every way one page breaks the frame contract, as readable lines, so a red
 * run reports all five pages at once instead of stopping at the first.
 * Returns the h1's left x too, for the across-pages check.
 */
function frameViolations(
  appPage: AppPage,
  width: AppPageWidth,
  frame: FrameMeasurement,
): { violations: string[]; headingLeft: number | null } {
  const at = `${appPage.name} @${width}`;
  const violations: string[] = [];

  if (frame.headerHeight === null || frame.headerBottom === null) {
    violations.push(`${at}: no [data-app-header]`);
  } else {
    if (!isNear(frame.headerHeight, APP_HEADER_HEIGHT)) {
      violations.push(
        `${at}: header is ${frame.headerHeight}px tall, expected ${APP_HEADER_HEIGHT}`,
      );
    }
    if (width >= SIDEBAR_BREAKPOINT) {
      if (frame.brandBottom === null) {
        violations.push(`${at}: no [data-sidebar-brand]`);
      } else if (!isNear(frame.brandBottom, frame.headerBottom)) {
        violations.push(
          `${at}: sidebar brand row ends at ${frame.brandBottom}, header at ${frame.headerBottom}`,
        );
      }
    }
  }

  if (frame.pageOverflow > 0) {
    violations.push(`${at}: page scrolls sideways by ${frame.pageOverflow}px`);
  }

  if (frame.headings.length !== 1) {
    violations.push(
      `${at}: ${frame.headings.length} visible h1s (${frame.headings.map((heading) => `"${heading.text}"`).join(", ")}), expected 1`,
    );
  }
  const heading = frame.headings[0];
  if (!heading) return { violations, headingLeft: null };

  if (!heading.insidePageHeader) {
    violations.push(`${at}: the h1 is not inside [data-page-header]`);
  }
  if (heading.fontSize !== "24px" || heading.fontWeight !== "600") {
    violations.push(
      `${at}: the h1 is ${heading.fontSize}/${heading.fontWeight}, expected 24px/600`,
    );
  }

  const expectedLeft = EXPECTED_CONTENT_LEFT[width];
  const contentLeft =
    expectedLeft === "main" ? frame.mainContentLeft : expectedLeft;
  if (contentLeft === null) {
    violations.push(`${at}: no <main> to read the content edge from`);
  } else if (!isNear(heading.left, contentLeft)) {
    violations.push(
      `${at}: the h1 starts at x=${heading.left}, expected ${contentLeft}`,
    );
  }

  if (frame.shellChildren === null) {
    violations.push(`${at}: no [data-page-shell]`);
  } else {
    // At least the header and one section: a page that wrapped every
    // section in one extra div would pass the edge check below vacuously.
    if (frame.shellChildren.length < 2) {
      violations.push(
        `${at}: [data-page-shell] has ${frame.shellChildren.length} visible children, expected at least 2`,
      );
    }
    for (const child of frame.shellChildren) {
      if (!isNear(child.left, heading.left)) {
        violations.push(
          `${at}: shell child ${child.element} starts at x=${child.left}, the h1 at ${heading.left}`,
        );
      }
    }
  }

  violations.push(...rhythmViolations(appPage, width, frame));

  return { violations, headingLeft: heading.left };
}

const centre = (box: { top: number; bottom: number }) =>
  (box.top + box.bottom) / 2;

/**
 * The shell's vertical contract, as drawn (s66b1 review m-2). jsdom pins the
 * classes (`page-shell.test.tsx`); only a browser shows the result:
 * - the header to the first section is 24px from 640 up and 16px below;
 * - header actions sit centred on the title row from 640 up, and in their
 *   own row under the description below it. They used to sit on the bottom
 *   of the whole block, and at 768 a two-line description pushed the button
 *   down and away from the title it acts on.
 */
function rhythmViolations(
  appPage: AppPage,
  width: AppPageWidth,
  frame: FrameMeasurement,
): string[] {
  const at = `${appPage.name} @${width}`;
  const violations: string[] = [];
  const isWide = width >= SM_BREAKPOINT;

  // No section at all is already reported as "fewer than 2 children".
  if (frame.headerToFirstSection !== null) {
    const expectedGap = isWide ? SHELL_GAP.wide : SHELL_GAP.narrow;
    if (!isNear(frame.headerToFirstSection, expectedGap)) {
      violations.push(
        `${at}: header to first section is ${frame.headerToFirstSection}px, expected ${expectedGap}`,
      );
    }
  }

  const { title, description, actions } = frame.headerAreas;
  if (!actions) {
    if (appPage.hasActions) violations.push(`${at}: no header actions`);
    return violations;
  }

  if (isWide) {
    if (!title) {
      violations.push(`${at}: no title row to centre the actions on`);
    } else if (!isNear(centre(actions), centre(title))) {
      violations.push(
        `${at}: actions centred at y=${centre(actions)}, the title row at y=${centre(title)}`,
      );
    }
  } else if (!description) {
    violations.push(`${at}: no description to place the actions under`);
  } else if (actions.top < description.bottom - EDGE_TOLERANCE) {
    violations.push(
      `${at}: actions start at y=${actions.top}, above the description's bottom at y=${description.bottom}`,
    );
  }

  return violations;
}

/**
 * The text colour of `target` and the colour actually behind it, both
 * resolved by the browser itself on a 1×1 canvas. Tailwind 4 writes
 * `bg-primary/12` as a `color-mix()`, which computes to an oklab colour no
 * string parser here understands; the canvas converts any CSS colour to
 * sRGB. The background is composited from the first opaque ancestor up,
 * which is what "the active nav item against its composited background"
 * means: a 12% tint over the sidebar card, not the tint alone.
 *
 * `property` picks what is measured against that background: the text
 * (`color`), or a control's boundary (`borderTopColor`). A border paints over
 * its own element's background (`background-clip: border-box`), so the same
 * composite is what sits behind it.
 */
type ForegroundProperty = "color" | "borderTopColor";

async function compositedColors(
  target: Locator,
  property: ForegroundProperty = "color",
): Promise<{ foreground: Rgb; background: Rgb }> {
  const { foreground, background } = await target.evaluate((element, key) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2D canvas context to resolve colours.");
    const paint = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    };
    const read = () => Array.from(context.getImageData(0, 0, 1, 1).data);

    const layers: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      layers.unshift(color);
      context.clearRect(0, 0, 1, 1);
      paint(color);
      if (read()[3] === 255) break;
    }

    context.clearRect(0, 0, 1, 1);
    // What a browser paints behind a root that sets no background.
    paint("#ffffff");
    layers.forEach(paint);
    const behind = read();
    paint(getComputedStyle(element)[key]);
    return { foreground: read(), background: behind };
  }, property);

  const toRgb = ([r = 0, g = 0, b = 0]: number[]): Rgb => ({ r, g, b, a: 1 });
  return { foreground: toRgb(foreground), background: toRgb(background) };
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Waits out colour transitions (nav items fade over 200 ms) after a theme switch. */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function contrastViolations(
  page: Page,
  appPage: AppPage,
  theme: "dark" | "light",
): Promise<string[]> {
  const at = `${appPage.name} @${CONTRAST_WIDTH} ${theme}`;
  const sidebar = page.getByRole("navigation", { name: "Dashboard" });
  const targets: Array<[string, Locator]> = [
    ["h1", page.locator("[data-page-header] h1").first()],
    [
      "description",
      page
        .locator("[data-page-header]")
        .getByText(appPage.description, { exact: true })
        .first(),
    ],
    [
      "inactive nav item",
      sidebar.getByRole("link", { name: INACTIVE_NAV_LABEL, exact: true }),
    ],
    [
      "active nav item",
      sidebar.locator('a[aria-current="page"]', {
        hasText: appPage.navLabel,
      }),
    ],
  ];
  // The overview is the breadcrumb root: it renders no trail there.
  if (appPage.path !== "/dashboard") {
    targets.push([
      "breadcrumb",
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Dashboard", exact: true }),
    ]);
  }

  const violations: string[] = [];
  for (const [label, target] of targets) {
    const violation = await contrastViolation(at, label, target);
    if (violation) violations.push(violation);
  }
  return violations;
}

/**
 * One measured pair as a readable line, or null when it clears `minimum`. A
 * target that is not there is a violation too: a check that measures nothing
 * passes vacuously.
 */
async function contrastViolation(
  at: string,
  label: string,
  target: Locator,
  minimum: number = MIN_TEXT_CONTRAST,
  property: ForegroundProperty = "color",
): Promise<string | null> {
  if ((await target.count()) === 0) return `${at}: no ${label} to measure`;
  const { foreground, background } = await compositedColors(target, property);
  const ratio = contrastRatio(foreground, background);
  return ratio < minimum
    ? `${at}: ${label} contrasts ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`
    : null;
}

/* -------------------------------------------------------------------------
 * s66b2 — flat, square, nothing clipped.
 *
 * s66b1 put every page in one frame; these checks are what jsdom cannot see
 * inside it. The Sites status filter was a row of pills in an
 * `overflow-x-auto` box with its scrollbar hidden: at 375 its last segments
 * sat past the edge with nothing to say they were there, and every unit test
 * was green. The Overview metrics and site rows lifted 1px with a shadow on
 * hover (`.surface-interactive`), the one thing on the page that moved, and
 * at 1024 and up the metric grid left its right third empty.
 * ---------------------------------------------------------------------- */

/**
 * `scrollWidth` may exceed `clientWidth` by one on fractional widths
 * (sub-pixel layout), never more for a real clip.
 */
const CLIP_TOLERANCE = 1;
/** Where the Settings tabs wrap onto two rows (s66a), so must stay in their list. */
const TABS_WIDTH: AppPageWidth = 375;
const OVERVIEW_PAGE = "overview";
const TABS_PAGE = "settings";
/** The injected negative control's class, unique to this harness. */
const CLIP_CONTROL_CLASS = "rcf-clip-control";

/**
 * Every visible element that hides content behind its own overflow box: its
 * computed `overflow-x` is not `visible`, and its content is more than
 * `CLIP_TOLERANCE` wider than its box. The exceptions are exactly AC 5's, and
 * nothing else:
 * - form controls: an <input> or <select> is its own internal scroller;
 * - `text-overflow: ellipsis`: the clip is drawn, so it is not hidden;
 * - `sr-only` nodes, 1 px by design;
 * - CodeBlock's <pre>, which scrolls on purpose under its Copy button.
 * A decorative `overflow-hidden` wrapper (a card, a progress track) is not an
 * exception: excluding those would let a clipped filter row pass.
 */
async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const FORM_CONTROLS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
    const describe = (element: Element) => {
      const className =
        typeof element.className === "string"
          ? element.className.split(/\s+/).slice(0, 4).join(".")
          : "";
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };
    // CodeBlock's anatomy: a header row holding the Copy button, then the
    // <pre>. No other <pre> on the app surface sits under a button row.
    const isCodeBlockPre = (element: Element) =>
      element.tagName === "PRE" &&
      element.previousElementSibling?.querySelector("button") != null;

    return Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        if (FORM_CONTROLS.has(element.tagName)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.width <= 1 && rect.height <= 1) return false;
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") {
          return false;
        }
        if (style.overflowX === "visible") return false;
        if (style.textOverflow === "ellipsis") return false;
        if (isCodeBlockPre(element)) return false;
        return element.scrollWidth - element.clientWidth > tolerance;
      })
      .map(
        (element) =>
          `${describe(element)} (content ${element.scrollWidth}px in a ${element.clientWidth}px box)`,
      );
  }, CLIP_TOLERANCE);
}

/**
 * The clip check's negative control (plan, "the point everything turns on").
 * It injects a row built like the old Sites status filter — pills in an
 * `overflow-x: auto` box with `scrollbar-width: none`, wider than the box —
 * and requires the check to report it, then removes it. A check that cannot
 * see this row proves nothing, and the proof does not depend on s66c's page.
 */
async function clipCheckReportsHiddenScrollRow(page: Page): Promise<boolean> {
  await page.evaluate((controlClass) => {
    const host = document.querySelector("main") ?? document.body;
    const row = document.createElement("div");
    row.className = controlClass;
    row.style.cssText =
      "display:flex;gap:8px;width:160px;overflow-x:auto;scrollbar-width:none;";
    for (const label of ["All", "Live", "Awaiting install", "Stale"]) {
      const pill = document.createElement("span");
      pill.textContent = label;
      pill.style.cssText = "flex-shrink:0;white-space:nowrap;padding:4px 12px;";
      row.appendChild(pill);
    }
    host.prepend(row);
  }, CLIP_CONTROL_CLASS);
  const clipped = await clippedElements(page);
  await page.evaluate(
    (controlClass) => document.querySelector(`.${controlClass}`)?.remove(),
    CLIP_CONTROL_CLASS,
  );
  return clipped.some((entry) => entry.includes(CLIP_CONTROL_CLASS));
}

/** A computed `box-shadow`'s layers: commas outside parentheses. */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      layers.push(value.slice(start, index));
      start = index + 1;
    }
  }
  layers.push(value.slice(start));
  return layers;
}

const SHADOW_COLOR =
  /(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|transparent/i;

function colorAlpha(color: string): number {
  if (/^transparent$/i.test(color)) return 0;
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = color.match(/^rgba\(([^)]*)\)$/i);
  if (rgba) {
    const channels = rgba[1].split(",");
    if (channels.length === 4) return Number(channels[3]);
  }
  return 1;
}

/**
 * Whether a computed `box-shadow` draws anything. Tailwind 4 writes "no
 * shadow" as a stack of transparent, zero-length layers (`shadow-none`, the
 * unused ring layers), so a value other than `none` is not yet a shadow: a
 * layer counts when its colour has alpha above 0 and it has a non-zero
 * offset, blur or spread.
 */
function drawsShadow(value: string): boolean {
  if (!value || value === "none") return false;
  return shadowLayers(value).some((layer) => {
    const color = layer.match(SHADOW_COLOR)?.[0] ?? "currentcolor";
    if (colorAlpha(color) === 0) return false;
    const lengths = layer.replace(SHADOW_COLOR, " ").match(/-?[\d.]+px/g);
    return (lengths ?? []).some((length) => parseFloat(length) !== 0);
  });
}

/** Visible elements in `main` (itself included) that draw a shadow. */
async function shadowedElementsInMain(page: Page): Promise<string[]> {
  const candidates = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return [];
    return [main, ...Array.from(main.querySelectorAll("*"))]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const className =
          typeof element.className === "string"
            ? element.className.split(/\s+/).slice(0, 4).join(".")
            : "";
        return {
          element: `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`,
          boxShadow: getComputedStyle(element).boxShadow,
        };
      })
      .filter(({ boxShadow }) => boxShadow !== "none");
  });
  return candidates
    .filter(({ boxShadow }) => drawsShadow(boxShadow))
    .map(({ element, boxShadow }) => `${element} (box-shadow ${boxShadow})`);
}

/** Waits for a hover's style change to start its transitions, then for them to end. */
async function settleHover(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await settleTransitions(page);
}

/**
 * Hovers `target` and reports any motion or shadow it gains. Tailwind 4's
 * translate utilities write the individual `translate` property, not
 * `transform`, so both are read: "never move" has to hold for either.
 */
async function hoverMotionViolations(
  page: Page,
  target: Locator,
  label: string,
): Promise<string[]> {
  if ((await target.count()) === 0) return [`no ${label} to hover`];
  await target.hover();
  await settleHover(page);
  const hovered = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transform: style.transform,
      translate: style.translate,
      boxShadow: style.boxShadow,
    };
  });
  await page.mouse.move(1, 1);
  await settleHover(page);

  const violations: string[] = [];
  if (hovered.transform !== "none") {
    violations.push(`hovered ${label} has transform ${hovered.transform}`);
  }
  if (hovered.translate !== "none") {
    violations.push(`hovered ${label} has translate ${hovered.translate}`);
  }
  if (drawsShadow(hovered.boxShadow)) {
    violations.push(`hovered ${label} has box-shadow ${hovered.boxShadow}`);
  }
  return violations;
}

/**
 * The rightmost Overview metric's right edge and the content's (`main`'s
 * right minus the ≥1024 gutter), or null without a Summary grid.
 */
async function metricGridEdges(
  page: Page,
): Promise<{ metricsRight: number; contentRight: number } | null> {
  return page.evaluate((gutter) => {
    const summary = document.querySelector('section[aria-label="Summary"]');
    const main = document.querySelector("main");
    if (!summary || !main || summary.children.length === 0) return null;
    const rights = Array.from(summary.children).map(
      (child) => child.getBoundingClientRect().right,
    );
    return {
      metricsRight: Math.max(...rights),
      contentRight: main.getBoundingClientRect().right - gutter,
    };
  }, WIDE_GUTTER);
}

/** Every visible tab outside its tablist's box, and how many tabs were measured. */
async function tabsOutsideTheirList(
  page: Page,
): Promise<{ measured: number; outside: string[] }> {
  return page.evaluate((tolerance) => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    let measured = 0;
    const outside: string[] = [];
    for (const list of Array.from(
      document.querySelectorAll('[role="tablist"]'),
    ).filter(isVisible)) {
      const box = list.getBoundingClientRect();
      for (const tab of Array.from(
        list.querySelectorAll('[role="tab"]'),
      ).filter(isVisible)) {
        measured += 1;
        const rect = tab.getBoundingClientRect();
        const inside =
          rect.left >= box.left - tolerance &&
          rect.right <= box.right + tolerance &&
          rect.top >= box.top - tolerance &&
          rect.bottom <= box.bottom + tolerance;
        if (!inside) {
          outside.push(
            `"${tab.textContent?.trim()}" at ${rect.left}–${rect.right}, its list ${box.left}–${box.right}`,
          );
        }
      }
    }
    return { measured, outside };
  }, EDGE_TOLERANCE);
}

/** The first row of the Overview's "Your sites" panel (a link per site). */
function firstSiteRow(page: Page): Locator {
  return page
    .getByRole("heading", { name: "Your sites" })
    .locator("xpath=ancestor::*[.//li//a][1]")
    .locator("li a")
    .first();
}

/** WCAG 1.4.11: a control's boundary against what sits behind it. */
const MIN_BOUNDARY_CONTRAST = 3;
/** The page that holds the theme picker, behind its Appearance tab. */
const THEME_PICKER_PAGE = "settings";

/**
 * s66b2 AC 6: contrast on the surfaces s66b2 repainted, which the frame's
 * pairs above (title, description, nav, breadcrumb) never reach. Each pair
 * is measured in the state a person meets it in:
 * - an Overview "Your sites" row while hovered: every line of its text on
 *   `hover:bg-surface-2`. The rows were separate cards until s66b2, and the
 *   hover tint is new;
 * - Settings → Appearance, pointer away: the selected theme's label on
 *   `bg-tone-accent-surface`, and an unselected option's 1px border against
 *   the card. That border shipped as `border-border` (`--line`, 1.45:1 on the
 *   card): decorative strength on a control, until the s66b2 review. A control
 *   boundary is `border-input` (design system, Borders), and needs 3:1.
 */
async function changedSurfaceContrastViolations(
  page: Page,
  appPage: AppPage,
  theme: "dark" | "light",
): Promise<string[]> {
  const at = `${appPage.name} @${CONTRAST_WIDTH} ${theme}`;
  const violations: string[] = [];
  const record = (violation: string | null) => {
    if (violation) violations.push(violation);
  };

  if (appPage.name === OVERVIEW_PAGE) {
    const row = firstSiteRow(page);
    if ((await row.count()) === 0) return [`${at}: no site row to hover`];
    await row.hover();
    await settleHover(page);
    const lines = row.locator("p");
    const count = await lines.count();
    if (count === 0) violations.push(`${at}: no text in the hovered site row`);
    for (let index = 0; index < count; index += 1) {
      const line = lines.nth(index);
      const text = (await line.textContent())?.trim() ?? "";
      record(
        await contrastViolation(at, `hovered site row text "${text}"`, line),
      );
    }
    await page.mouse.move(1, 1);
    await settleHover(page);
  }

  if (appPage.name === THEME_PICKER_PAGE) {
    await page.getByRole("tab", { name: "Appearance" }).click();
    const picker = page.getByRole("radiogroup", { name: "Theme" });
    await page.mouse.move(1, 1);
    await settleHover(page);
    record(
      await contrastViolation(
        at,
        "selected theme label",
        picker.getByRole("radio", { checked: true }).locator("p").first(),
      ),
    );
    record(
      await contrastViolation(
        at,
        "unselected theme option's border",
        picker.getByRole("radio", { checked: false }).first(),
        MIN_BOUNDARY_CONTRAST,
        "borderTopColor",
      ),
    );
  }

  return violations;
}

/**
 * s66b2's checks on one app page, as readable lines (AC 2, 4, 5): nothing
 * clipped, no shadow at rest in `main`; on the Overview, a hovered metric and
 * site row that stay put, and a metric grid that reaches the content's right
 * edge at ≥1024; at 375, every tab inside its list.
 */
async function pagePassViolations(
  page: Page,
  appPage: AppPage,
  width: AppPageWidth,
): Promise<string[]> {
  const at = `${appPage.name} @${width}`;
  const violations: string[] = [];

  await page.mouse.move(1, 1);
  await settleHover(page);

  for (const clipped of await clippedElements(page)) {
    violations.push(`${at}: ${clipped} hides content`);
  }
  for (const shadowed of await shadowedElementsInMain(page)) {
    violations.push(`${at}: at rest, ${shadowed}`);
  }

  if (width === TABS_WIDTH) {
    const tabs = await tabsOutsideTheirList(page);
    if (appPage.name === TABS_PAGE && tabs.measured === 0) {
      violations.push(`${at}: no tabs to measure`);
    }
    for (const tab of tabs.outside) {
      violations.push(`${at}: tab ${tab}`);
    }
  }

  if (appPage.name === OVERVIEW_PAGE) {
    const metric = page
      .getByRole("region", { name: "Summary" })
      .getByRole("link")
      .first();
    for (const violation of [
      ...(await hoverMotionViolations(page, metric, "metric")),
      ...(await hoverMotionViolations(page, firstSiteRow(page), "site row")),
    ]) {
      violations.push(`${at}: ${violation}`);
    }

    if (width >= SIDEBAR_BREAKPOINT) {
      const edges = await metricGridEdges(page);
      if (!edges) {
        violations.push(`${at}: no Summary metric grid`);
      } else if (!isNear(edges.metricsRight, edges.contentRight)) {
        violations.push(
          `${at}: the rightmost metric ends at x=${edges.metricsRight}, the content at ${edges.contentRight}`,
        );
      }
    }
  }

  return violations;
}

test.describe("s66b app pages", () => {
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

  for (const width of APP_PAGE_WIDTHS) {
    test(`app pages @${width}`, async ({ page }) => {
      if (!supabase) throw new Error("Layout harness client is not ready.");
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.emulateMedia({ colorScheme: "dark" });
      await signInAsLayoutOwner(page, supabase, owner, "/dashboard");

      const violations: string[] = [];
      const headingLefts: Array<[string, number]> = [];

      for (const appPage of APP_PAGES) {
        await page.goto(appPage.path);
        await page.waitForLoadState("networkidle");
        await capture(S66B_CAPTURE_ROOT, page, `${appPage.name}-${width}`, {
          fullPage: true,
        });

        const frame = await measureFrame(page);
        const result = frameViolations(appPage, width, frame);
        violations.push(...result.violations);
        if (result.headingLeft !== null) {
          headingLefts.push([appPage.name, result.headingLeft]);
        }

        // s66b2: flat, nothing clipped, the grid and the tabs (AC 2, 4, 5).
        violations.push(...(await pagePassViolations(page, appPage, width)));
        if (
          appPage.name === OVERVIEW_PAGE &&
          !(await clipCheckReportsHiddenScrollRow(page))
        ) {
          violations.push(
            `${appPage.name} @${width}: the clip check missed an injected hidden-scrollbar row (negative control)`,
          );
        }

        if (width === CONTRAST_WIDTH) {
          for (const theme of ["dark", "light"] as const) {
            await applyTheme(page, theme);
            await page.mouse.move(1, 1);
            await settleTransitions(page);
            violations.push(
              ...(await contrastViolations(page, appPage, theme)),
              // s66b2 AC 6: the repainted surfaces, in both themes.
              ...(await changedSurfaceContrastViolations(page, appPage, theme)),
            );
          }
        }
      }

      // One left edge per width: the same x on every page, not five values
      // that each happen to be within tolerance of a constant.
      const lefts = headingLefts.map(([, left]) => left);
      if (
        lefts.length > 0 &&
        Math.max(...lefts) - Math.min(...lefts) > EDGE_TOLERANCE
      ) {
        violations.push(
          `@${width}: the h1 starts at different x across pages: ${headingLefts
            .map(([name, left]) => `${name} ${left}`)
            .join(", ")}`,
        );
      }

      expect(violations).toEqual([]);
    });
  }
});

/**
 * The four app pages outside the frame (ADR 053 §3): signed out, each a
 * centred `max-w-md` column with its one h1 in `.text-page-title`. `/login`,
 * `/signup` and `/auth/error` had none — `CardTitle` is an h3 — so a screen
 * reader landing there found no page title at all.
 */
interface StandalonePage {
  path: string;
  /** Capture file stem. */
  name: string;
}

const STANDALONE_PAGES: readonly StandalonePage[] = [
  { path: "/login", name: "login" },
  { path: "/signup", name: "signup" },
  { path: "/auth/error", name: "auth-error" },
  { path: "/edit", name: "edit" },
];

/**
 * s66b2 AC 6 on a standalone page: its h1 (now `.text-page-title`, was an h3
 * `CardTitle`) and the description right under it, on whatever surface they
 * sit on (the card, or the page on /edit). On all four pages the description
 * is the h1's next sibling, a <p>.
 */
async function standaloneContrastViolations(
  page: Page,
  standalone: StandalonePage,
  theme: "dark" | "light",
): Promise<string[]> {
  const at = `${standalone.name} @${CONTRAST_WIDTH} ${theme}`;
  const violations: string[] = [];
  for (const [label, target] of [
    ["h1", page.locator("h1").first()],
    ["description", page.locator("h1 + p").first()],
  ] as const) {
    const violation = await contrastViolation(at, label, target);
    if (violation) violations.push(violation);
  }
  return violations;
}

test.describe("s66b standalone pages", () => {
  test.setTimeout(120_000);

  for (const width of APP_PAGE_WIDTHS) {
    // Playwright's `page` fixture is a fresh browser context per test, with
    // no cookies or storage: these pages are measured signed out.
    test(`standalone pages @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.emulateMedia({ colorScheme: "dark" });

      const violations: string[] = [];
      for (const standalone of STANDALONE_PAGES) {
        const at = `${standalone.name} @${width}`;
        await page.goto(standalone.path);
        await page.waitForLoadState("networkidle");
        await capture(S66B_CAPTURE_ROOT, page, `${standalone.name}-${width}`, {
          fullPage: true,
        });

        const { headings, pageOverflow } = await measureFrame(page);
        if (headings.length !== 1) {
          violations.push(
            `${at}: ${headings.length} visible h1s (${headings.map((heading) => `"${heading.text}"`).join(", ")}), expected 1`,
          );
        } else if (
          headings[0].fontSize !== "24px" ||
          headings[0].fontWeight !== "600"
        ) {
          violations.push(
            `${at}: the h1 is ${headings[0].fontSize}/${headings[0].fontWeight}, expected 24px/600 (.text-page-title)`,
          );
        }
        if (pageOverflow > 0) {
          violations.push(`${at}: page scrolls sideways by ${pageOverflow}px`);
        }
        for (const clipped of await clippedElements(page)) {
          violations.push(`${at}: ${clipped} hides content`);
        }

        if (width === CONTRAST_WIDTH) {
          for (const theme of ["dark", "light"] as const) {
            await applyTheme(page, theme);
            await page.mouse.move(1, 1);
            await settleTransitions(page);
            violations.push(
              ...(await standaloneContrastViolations(page, standalone, theme)),
            );
          }
          // The emulated scheme outlives the navigation: the next page is
          // measured and captured dark, as every other width is.
          await page.emulateMedia({ colorScheme: "dark" });
        }
      }

      expect(violations).toEqual([]);
    });
  }
});
