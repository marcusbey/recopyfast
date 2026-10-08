import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { Server } from "node:http";
import {
  API_ORIGIN,
  SITE_ID,
  SPA_PAGES,
  TAGLINE,
  buildReactBundles,
  startSpaHost,
} from "./support/embed-spa-host";

/**
 * s67 — the plain snippet on sites that render in the browser (ADR 049).
 *
 * On openflows.ai (React, client router) the embed scanned before React
 * rendered, attached its only MutationObserver after four round trips, fetched
 * published copy once per page load and wrote it by replacing React's text
 * nodes: 0 editable elements, no published copy after an in-app navigation,
 * and a React root that unmounted the first time it re-rendered an edited
 * element. These five tests run the real artifact against local fixtures of
 * each of those shapes (e2e/support/embed-spa-host.ts):
 *
 *   E1  framework-free SPA: late render, pushState navigation, Back, query and
 *       hash changes, a host write-back, a ticker, bounded discovery, history
 *       left unpatched, no page error (AC 1–5, 9, 11);
 *   E2  the same SPA with the Navigation API removed (AC 3 on older browsers),
 *       and a route render that only rewrites text in place (review finding 1);
 *   E3  React 19 client render: the NotFoundError crash regression (AC 13);
 *   E4  React 19 server render: no crash after hydration, and stamping before
 *       hydration logs no React error (AC 6, 13);
 *   E5  edit mode across an in-app navigation (AC 7).
 *
 * Network: the snippet's API is `https://api.rcf-spa.test`, answered here by
 * `context.route` from in-memory rows. Requests to the app (the artifact) and
 * to the local host continue; EVERYTHING else is aborted and fails the test.
 * No Supabase, no production API.
 *
 * Page-scoped ids are learned from the embed, never re-implemented: a first
 * context loads `/spa/` and `/spa/about` and records the discovery reports;
 * the rows each test "publishes" are keyed by what the embed itself reported.
 */

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const APP_ORIGIN = new URL(APP_URL).origin;
const HOST_PORT = Number(process.env.RECOPYFAST_SPA_PORT || "4177");
// `localhost`, not 127.0.0.1: the embed's demo edit token (E5) is honoured on
// localhost only (recopyfast.src.js, initStagingMode).
const HOST_URL = `http://localhost:${HOST_PORT}`;
const HOST_ORIGIN = new URL(HOST_URL).origin;

const HOME = "/spa";
const ABOUT = "/spa/about";
const HOME_HEADLINE = SPA_PAGES[HOME].headline;
const HOME_PUBLISHED = "Home headline, published";
const ABOUT_HEADLINE = SPA_PAGES[ABOUT].headline;
const ABOUT_PUBLISHED = "About headline, published";
const TAGLINE_PUBLISHED = "Tagline, published for the home page only";
/** An unedited row: `current_content === original_content`. Must never be written (AC 11). */
const FROZEN_CLOCK = "Frozen discovery copy";
const PUBLISHED_TEXTS = [
  HOME_PUBLISHED,
  ABOUT_PUBLISHED,
  TAGLINE_PUBLISHED,
  FROZEN_CLOCK,
];

interface Row {
  element_id: string;
  original_content: string | null;
  current_content: string;
  page_path: string | null;
  metadata: Record<string, unknown>;
}

interface Reported {
  content: string;
  page_path: string | null;
  type: string;
}

interface ApiLog {
  contentGets: string[];
  stagingGets: string[];
  posts: Array<Record<string, Reported>>;
  aborted: string[];
}

function newLog(): ApiLog {
  return { contentGets: [], stagingGets: [], posts: [], aborted: [] };
}

function row(
  elementId: string,
  original: string | null,
  current: string,
  pagePath: string | null,
): Row {
  return {
    element_id: elementId,
    original_content: original,
    current_content: current,
    page_path: pagePath,
    metadata: {},
  };
}

/** The API, from memory. Mirrors the server's page scoping: a page read includes shared rows. */
async function installApi(context: BrowserContext, rows: Row[], log: ApiLog) {
  const rowsFor = (pagePath: string | null) =>
    rows.filter(
      (candidate) =>
        candidate.page_path === null || candidate.page_path === pagePath,
    );

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === APP_ORIGIN || url.origin === HOST_ORIGIN) {
      await route.continue();
      return;
    }
    if (url.origin !== API_ORIGIN) {
      log.aborted.push(`${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }

    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization,content-type,x-rcf-editor-grant",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const pagePath = url.searchParams.get("page_path");
    if (
      url.pathname === `/api/content/${SITE_ID}` &&
      request.method() === "GET"
    ) {
      log.contentGets.push(pagePath ?? "");
      await json(rowsFor(pagePath));
      return;
    }
    if (
      url.pathname === `/api/content/${SITE_ID}` &&
      request.method() === "POST"
    ) {
      log.posts.push(JSON.parse(request.postData() || "{}"));
      await json({ success: true });
      return;
    }
    if (
      url.pathname === `/api/staging/content/${SITE_ID}` &&
      request.method() === "GET"
    ) {
      log.stagingGets.push(pagePath ?? "");
      await json({ content: rowsFor(pagePath) });
      return;
    }
    if (url.pathname.startsWith("/api/ab-tests/active/")) {
      await json({ tests: [] });
      return;
    }
    await json({});
  });
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/**
 * Probes installed before any page script: the original history methods,
 * every frame's headline text, and every value the ticker's clock ever shows.
 */
const SPA_PROBE = () => {
  const probe = window as unknown as {
    __originalPushState: unknown;
    __originalReplaceState: unknown;
    __headlineFrames: Array<string | null>;
    __clockValues: string[];
  };
  probe.__originalPushState = history.pushState;
  probe.__originalReplaceState = history.replaceState;
  probe.__headlineFrames = [];
  probe.__clockValues = [];
  const frame = () => {
    const headline = document.querySelector("#outlet h1");
    probe.__headlineFrames.push(headline ? headline.textContent : null);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener("DOMContentLoaded", () => {
    const clock = document.getElementById("clock");
    if (!clock) return;
    new MutationObserver(() =>
      probe.__clockValues.push(clock.textContent || ""),
    ).observe(clock, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
};

interface LearnedPage {
  headline: string;
  lead: string;
  tagline: string;
  clock: string;
}

/** The ids the embed itself reported for a page, found by their authored text. */
function learnedFrom(
  posts: ApiLog["posts"],
  pagePath: string,
): LearnedPage | null {
  const entries = posts.flatMap((body) =>
    Object.entries(body).filter(([, entry]) => entry.page_path === pagePath),
  );
  const idOf = (match: (content: string) => boolean) =>
    entries.find(([, entry]) => match(entry.content))?.[0];
  const learned = {
    headline: idOf((content) => content === SPA_PAGES[pagePath].headline),
    lead: idOf((content) => content === SPA_PAGES[pagePath].lead),
    tagline: idOf((content) => content === TAGLINE),
    clock: idOf((content) => /^tick \d+$/.test(content)),
  };
  return Object.values(learned).every(Boolean)
    ? (learned as LearnedPage)
    : null;
}

async function learnSpaIds(browser: Browser) {
  const context = await browser.newContext();
  const log = newLog();
  await installApi(context, [], log);
  const page = await context.newPage();
  const learned: Record<string, LearnedPage> = {};
  try {
    for (const [pagePath, url] of [
      [HOME, `${HOST_URL}/spa/`],
      [ABOUT, `${HOST_URL}/spa/about`],
    ]) {
      await page.goto(url);
      // A late-rendered element is reported by the next discovery report the
      // coalescing allows, at most ten seconds after the first.
      await expect
        .poll(() => learnedFrom(log.posts, pagePath), { timeout: 25_000 })
        .not.toBeNull();
      learned[pagePath] = learnedFrom(log.posts, pagePath)!;
    }
    expect(log.aborted).toEqual([]);
  } finally {
    await context.close();
  }
  return learned;
}

function spaRows(learned: Record<string, LearnedPage>): Row[] {
  return [
    row(learned[HOME].headline, HOME_HEADLINE, HOME_PUBLISHED, HOME),
    row(learned[ABOUT].headline, ABOUT_HEADLINE, ABOUT_PUBLISHED, ABOUT),
    row(learned[HOME].tagline, TAGLINE, TAGLINE_PUBLISHED, HOME),
    row(learned[HOME].clock, FROZEN_CLOCK, FROZEN_CLOCK, HOME),
  ];
}

test.describe("the plain snippet on single-page apps (s67)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let host: Server | null = null;
  let learned: Record<string, LearnedPage> = {};

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    host = await startSpaHost(HOST_PORT, APP_URL, await buildReactBundles());
    learned = await learnSpaIds(browser);
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!host) {
        resolve();
        return;
      }
      host.close(() => resolve());
    });
  });

  async function openSpa(
    browser: Browser,
    options: { withoutNavigationApi?: boolean } = {},
  ) {
    const context = await browser.newContext();
    const log = newLog();
    await installApi(context, spaRows(learned), log);
    await context.addInitScript(SPA_PROBE);
    if (options.withoutNavigationApi) {
      await context.addInitScript(() => {
        Object.defineProperty(window, "navigation", {
          configurable: true,
          value: undefined,
        });
      });
    }
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    return { context, page, log, errors };
  }

  test("E1: a framework-free SPA gets published copy on load, after pushState, on Back, and keeps it", async ({
    browser,
  }) => {
    const { context, page, log, errors } = await openSpa(browser);
    try {
      await page.goto(`${HOST_URL}/spa/`);
      const headline = page.locator("#outlet h1");
      const tagline = page.locator("#site-header .tagline");

      // AC 1 + 2: rendered 600 ms after load, found, published.
      await expect(headline).toHaveText(HOME_PUBLISHED);
      await expect(headline).toHaveAttribute(
        "data-rcf-id",
        learned[HOME].headline,
      );
      await expect(tagline).toHaveText(TAGLINE_PUBLISHED);

      // AC 4: the host writes the authored copy back one second later. The
      // embed re-applies it before the next frame, so no frame after the first
      // published one ever shows the authored headline.
      await page.waitForFunction(
        () =>
          (window as unknown as { __writeBack?: boolean }).__writeBack === true,
      );
      await page.waitForTimeout(250);
      await expect(headline).toHaveText(HOME_PUBLISHED);

      // AC 5 + 11: the 100 ms ticker kept ticking (no starvation), and its
      // unedited discovery row was never written.
      const clock = page.locator("#clock");
      const before = await clock.textContent();
      await expect(clock).not.toHaveText(before ?? "");

      // AC 3: in-app navigation. One GET for the new path; the persisting
      // tagline is re-identified with the id a full load of /spa/about gives it,
      // and shows its authored copy again because no /spa/about row exists.
      await page.click('a[href="/spa/about"]');
      await expect(headline).toHaveText(ABOUT_PUBLISHED);
      await expect(headline).toHaveAttribute(
        "data-rcf-id",
        learned[ABOUT].headline,
      );
      await expect(tagline).toHaveText(TAGLINE);
      await expect(tagline).toHaveAttribute(
        "data-rcf-id",
        learned[ABOUT].tagline,
      );

      // Back: the cached rows apply, no GET.
      await page.goBack();
      await expect(headline).toHaveText(HOME_PUBLISHED);
      await expect(tagline).toHaveText(TAGLINE_PUBLISHED);

      // Frames up to here: first load, the host write-back, the navigation
      // and Back. Taken before the hash step below, because setting
      // `location.hash` fires `popstate` and this fixture re-renders on it
      // with brand-new nodes: new nodes on an unchanged path wait for the
      // debounced rescan (ADR 049, research "Risks"), which is not what this
      // assertion is about.
      const probe = await page.evaluate(() => {
        const state = window as unknown as {
          __originalPushState: unknown;
          __originalReplaceState: unknown;
          __headlineFrames: Array<string | null>;
          __clockValues: string[];
        };
        return {
          frames: state.__headlineFrames.slice(),
          clockValues: state.__clockValues.slice(),
        };
      });

      // A query- or hash-only change is not a navigation for the embed.
      await page.evaluate(() => {
        history.pushState(null, "", "/spa/?q=1");
        location.hash = "section";
      });
      await page.waitForTimeout(500);

      expect(log.contentGets).toEqual([HOME, ABOUT]);

      // AC 9: the embed patches no host global.
      expect(
        await page.evaluate(() => {
          const state = window as unknown as {
            __originalPushState: unknown;
            __originalReplaceState: unknown;
          };
          return (
            history.pushState === state.__originalPushState &&
            history.replaceState === state.__originalReplaceState
          );
        }),
      ).toBe(true);
      const firstPublished = probe.frames.indexOf(HOME_PUBLISHED);
      expect(firstPublished).toBeGreaterThan(-1);
      expect(
        probe.frames
          .slice(firstPublished)
          .filter((text) => text === HOME_HEADLINE),
      ).toEqual([]);
      expect(probe.clockValues.length).toBeGreaterThan(5);
      expect(probe.clockValues).not.toContain(FROZEN_CLOCK);

      // Bounded discovery: at most one immediate report per page view, and no
      // report ever carries published copy as if it were authored (s65a).
      expect(log.posts.length).toBeLessThanOrEqual(3);
      for (const body of log.posts) {
        for (const entry of Object.values(body)) {
          expect(PUBLISHED_TEXTS).not.toContain(entry.content);
        }
      }

      expect(errors).toEqual([]);
      expect(log.aborted).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("E2: without the Navigation API, navigation, Back and a text-only route render get their page's copy, each path fetched once", async ({
    browser,
  }) => {
    const { context, page, log, errors } = await openSpa(browser, {
      withoutNavigationApi: true,
    });
    try {
      await page.goto(`${HOST_URL}/spa/`);
      expect(
        await page.evaluate(
          () =>
            "navigation" in window &&
            (window as unknown as { navigation?: unknown }).navigation,
        ),
      ).toBeFalsy();
      const headline = page.locator("#outlet h1");

      await expect(headline).toHaveText(HOME_PUBLISHED);
      await page.click('a[href="/spa/about"]');
      await expect(headline).toHaveText(ABOUT_PUBLISHED);
      await page.goBack();
      await expect(headline).toHaveText(HOME_PUBLISHED);

      // Review finding 1: a param route reuses its components, so the new
      // page arrives as text changes on the same nodes — no added node. The
      // headline must still be re-identified under the new path and get its
      // published copy (from the cache: no new GET). Only after the fixture's
      // one-shot write-back AND the debounced rescan it schedules (its
      // `textContent` assignment adds a node): that pending rescan, firing
      // after the click, would re-identify the page by itself and hide the gap.
      await page.waitForFunction(
        () =>
          (window as unknown as { __writeBack?: boolean }).__writeBack === true,
      );
      await page.waitForTimeout(500);
      await page.click("a[data-in-place]");
      await expect(headline).toHaveText(ABOUT_PUBLISHED);
      await expect(headline).toHaveAttribute(
        "data-rcf-id",
        learned[ABOUT].headline,
      );
      await page.waitForTimeout(300);

      expect(log.contentGets).toEqual([HOME, ABOUT]);
      expect(errors).toEqual([]);
      expect(log.aborted).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("E3: a React 19 client render keeps running after the embed writes into its text", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const log = newLog();
    await installApi(
      context,
      [
        row("r-hero", "Hello world", "Published hero", null),
        row("r-lead", "Lead text", "Published lead", null),
      ],
      log,
    );
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    try {
      await page.goto(`${HOST_URL}/react/`);
      const hero = page.locator('[data-rcf-id="r-hero"]');
      const lead = page.locator('[data-rcf-id="r-lead"]');
      await expect(hero).toHaveText("Published hero");
      await expect(lead).toHaveText("Published lead");

      // R1c + R1d: React removes a text node it rendered, and inserts an
      // element before one. With the text nodes replaced, both threw
      // NotFoundError and React 19 unmounted the whole root.
      await page.evaluate(() =>
        (window as unknown as { __toggle: () => void }).__toggle(),
      );
      await page.waitForTimeout(250);

      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __reactErrors: string[] }).__reactErrors,
        ),
      ).toEqual([]);
      await expect(page.locator("#react-root #app")).toHaveCount(1);
      await expect(hero).toHaveText("Published hero");
      await expect(lead).toHaveText("Published lead");
      await expect(lead.locator("b")).toHaveCount(1);
      expect(errors).toEqual([]);
      expect(log.aborted).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("E4: a React 19 server render survives the embed after hydration, and stamping before it", async ({
    browser,
  }) => {
    // Hydrated first, then the embed writes, then React re-renders structurally.
    const hydratedContext = await browser.newContext();
    const hydratedLog = newLog();
    await installApi(
      hydratedContext,
      [
        row("s-hero", "Hello world", "Published hero", null),
        row("s-lead", "Lead text", "Published lead", null),
      ],
      hydratedLog,
    );
    const hydrated = await hydratedContext.newPage();
    const hydratedErrors = collectPageErrors(hydrated);
    try {
      await hydrated.goto(
        `${HOST_URL}/ssr/?hydrateDelay=0&snippet=after-hydration`,
      );
      const hero = hydrated.locator('[data-rcf-id="s-hero"]');
      await expect(hero).toHaveText("Published hero");
      await hydrated.evaluate(() =>
        (window as unknown as { __toggle: () => void }).__toggle(),
      );
      await hydrated.waitForTimeout(250);

      expect(
        await hydrated.evaluate(
          () =>
            (window as unknown as { __reactErrors: string[] }).__reactErrors,
        ),
      ).toEqual([]);
      await expect(hydrated.locator("#react-root #app")).toHaveCount(1);
      await expect(hero).toHaveText("Published hero");
      expect(hydratedErrors).toEqual([]);
      expect(hydratedLog.aborted).toEqual([]);
    } finally {
      await hydratedContext.close();
    }

    // The embed boots before hydration and only stamps: nothing is edited, so
    // nothing may be written, and React must hydrate without a mismatch.
    const stampedContext = await browser.newContext();
    const stampedLog = newLog();
    await installApi(stampedContext, [], stampedLog);
    const stamped = await stampedContext.newPage();
    const stampedErrors = collectPageErrors(stamped);
    try {
      await stamped.goto(`${HOST_URL}/ssr/?hydrateDelay=1500`);
      await expect(stamped.locator("#app p.plain[data-rcf-id]")).toHaveCount(1);
      await stamped.waitForFunction(
        () =>
          (window as unknown as { __hydrated?: boolean }).__hydrated === true,
      );
      await stamped.evaluate(() =>
        (window as unknown as { __toggle: () => void }).__toggle(),
      );
      await stamped.waitForTimeout(250);

      expect(
        await stamped.evaluate(
          () =>
            (window as unknown as { __reactErrors: string[] }).__reactErrors,
        ),
      ).toEqual([]);
      await expect(stamped.locator('[data-rcf-id="s-hero"]')).toHaveText(
        "Hello",
      );
      expect(stampedErrors).toEqual([]);
      expect(stampedLog.aborted).toEqual([]);
    } finally {
      await stampedContext.close();
    }
  });

  test("E5: an editor keeps the edit session across an in-app navigation and can edit the new page", async ({
    browser,
  }) => {
    const { context, page, log, errors } = await openSpa(browser);
    try {
      // The localhost demo token: edit mode without a staging validation call.
      await page.goto(`${HOST_URL}/spa/?rcf_staging=1&rcf_token=test_e5`);
      const banner = page.locator("#rcf-staging-banner");
      const headline = page.locator("#outlet h1");
      await expect(banner).toBeVisible();
      await expect(headline).toHaveText(HOME_PUBLISHED);

      await page.click('a[href="/spa/about"]');
      await expect(headline).toHaveText(ABOUT_PUBLISHED);
      await expect(banner).toBeVisible();
      expect(
        await page.evaluate(() =>
          Boolean(
            (
              window as unknown as {
                recopyfast: { getStagingAccess(): unknown };
              }
            ).recopyfast.getStagingAccess(),
          ),
        ),
      ).toBe(true);
      expect(log.stagingGets).toEqual([HOME, ABOUT]);

      await headline.click();
      await expect(headline).toHaveAttribute("contenteditable", "true");
      expect(errors).toEqual([]);
      expect(log.aborted).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
