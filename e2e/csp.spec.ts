import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { THEME_INIT_SCRIPT } from "../src/lib/theme/theme-init-script";
import { createLocalServiceRoleClient } from "./support/local-supabase";
import {
  createLayoutOwnerFixture,
  deleteLayoutOwner,
  seedLayoutOwner,
  signInAsLayoutOwner,
} from "./support/owner-session";

/**
 * s79 (s69 L1, ADR 059) — the Content Security Policy, in a real browser,
 * against a production build.
 *
 * The app surface (`/dashboard`, `/login`, `/signup`, `/edit`) runs under a
 * per-request nonce with `'strict-dynamic'`; the static marketing surface
 * keeps `'self' 'unsafe-inline'`. The failure this guards is not a weaker
 * policy but a broken page: a prerendered page under the nonce policy has
 * every script refused and never hydrates (measured while researching this
 * story — `/signup` blocked 14 chunks and 3 inline scripts). Unit tests cannot
 * see that: it only exists in `next build` output, which is what CI serves.
 *
 * Two signals per page: no `script-src*` violation (from the document's
 * `securitypolicyviolation` events and the console), and React attached to
 * the DOM. Only script directives are counted: CI serves the production build
 * from http://127.0.0.1, where the unchanged `connect-src` (https/wss only in
 * production) refuses the local Supabase — an artefact of the stack, not of
 * this policy.
 */

const NONCE_SOURCE = /'nonce-([A-Za-z0-9+/_-]+={0,2})'/;
const SCRIPT_DIRECTIVE = /script-src/;

async function watchScriptViolations(
  page: Page,
): Promise<() => Promise<string[]>> {
  const fromConsole: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy/i.test(text) && SCRIPT_DIRECTIVE.test(text)) {
      fromConsole.push(text);
    }
  });
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => {
    const fromDocument = await page.evaluate(
      () =>
        (window as unknown as { __cspViolations?: string[] }).__cspViolations ??
        [],
    );
    return [
      ...fromConsole,
      ...fromDocument.filter((entry) => SCRIPT_DIRECTIVE.test(entry)),
    ];
  };
}

/** React attaches a fiber to every node it hydrates; none means no hydration. */
async function isHydrated(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("body *")).some((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactFiber$")),
    ),
  );
}

function nonceOf(policy: string | undefined): string | undefined {
  return NONCE_SOURCE.exec(policy ?? "")?.[1];
}

test.describe("s79 content security policy", () => {
  test("the marketing surface: / and /pricing hydrate under the static policy", async ({
    page,
  }) => {
    const violations = await watchScriptViolations(page);

    const response = await page.goto("/", { waitUntil: "load" });
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline';",
    );
    expect(nonceOf(headers["content-security-policy"])).toBeUndefined();
    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(headers["x-xss-protection"]).toBeUndefined();
    await expect.poll(() => isHydrated(page)).toBe(true);
    expect(await violations()).toEqual([]);

    await page.goto("/pricing", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/#pricing$/);
    await expect.poll(() => isHydrated(page)).toBe(true);
    expect(await violations()).toEqual([]);
  });

  for (const path of ["/login", "/signup", "/edit"]) {
    test(`the app surface: ${path} stamps a fresh nonce on every Next script`, async ({
      page,
      request,
    }) => {
      const first = await request.get(path);
      const second = await request.get(path);
      const policy = first.headers()["content-security-policy"];
      const nonce = nonceOf(policy);

      expect(first.status()).toBe(200);
      expect(policy).toContain("'strict-dynamic'");
      expect(nonce).toBeTruthy();
      expect(nonceOf(second.headers()["content-security-policy"])).not.toBe(
        nonce,
      );

      // Every executable script Next wrote carries the header's nonce; the
      // one that does not is ours, the theme script, allowed by its hash.
      const html = await first.text();
      const scripts = Array.from(
        html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
      ).filter(([, attributes]) => !/type="application\/ld\+json"/.test(attributes));
      const unstamped = scripts
        .filter(([, attributes]) => !attributes.includes(`nonce="${nonce}"`))
        .map(([, , body]) => body);
      expect(scripts.length).toBeGreaterThan(3);
      expect(unstamped).toEqual([THEME_INIT_SCRIPT]);
      for (const [preload] of html.matchAll(/<link\b[^>]*\bas="script"[^>]*>/g)) {
        expect(preload).toContain(`nonce="${nonce}"`);
      }

      const violations = await watchScriptViolations(page);
      await page.goto(path, { waitUntil: "load" });
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);
    });
  }

  test.describe("signed in", () => {
    test.describe.configure({ mode: "serial" });

    let supabase: SupabaseClient;
    const owner = createLayoutOwnerFixture();

    test.beforeAll(async () => {
      supabase = createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E");
      await seedLayoutOwner(supabase, owner);
    });

    test.afterAll(async () => {
      if (supabase) await deleteLayoutOwner(supabase, owner);
    });

    test("the dashboard runs under the nonce policy with no script violation", async ({
      page,
    }) => {
      const violations = await watchScriptViolations(page);
      const dashboardPolicies: Array<string | undefined> = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          response.request().resourceType() === "document" &&
          url.pathname.startsWith("/dashboard")
        ) {
          dashboardPolicies.push(response.headers()["content-security-policy"]);
        }
      });

      await signInAsLayoutOwner(page, supabase, owner, "/dashboard");
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);

      await page.goto(`/dashboard/sites/${owner.siteId}`, { waitUntil: "load" });
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);

      expect(dashboardPolicies.length).toBeGreaterThanOrEqual(2);
      for (const policy of dashboardPolicies) {
        expect(nonceOf(policy)).toBeTruthy();
      }
    });
  });
});
