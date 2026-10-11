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
    (window as unknown as { __cspViolations: string[] }).__cspViolations =
      store;
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

/**
 * A harmless stand-in for an injected inline event handler. The marketing
 * document deliberately allows it today; a nonce app document must block it.
 */
async function inlineHandlerRuns(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probeWindow = window as typeof window & {
      __rcfCspInlineProbe?: boolean;
    };
    delete probeWindow.__rcfCspInlineProbe;

    const probe = document.createElement("button");
    probe.hidden = true;
    probe.setAttribute("onclick", "window.__rcfCspInlineProbe = true");
    document.body.appendChild(probe);
    probe.click();
    probe.remove();

    return probeWindow.__rcfCspInlineProbe === true;
  });
}

function nonceOf(policy: string | undefined): string | undefined {
  return NONCE_SOURCE.exec(policy ?? "")?.[1];
}

/**
 * Every executable script Next wrote carries the header's nonce; the one that
 * does not is ours, the theme script, allowed by its hash. Script preloads
 * carry it too.
 */
function expectEveryNextScriptStamped(html: string, nonce: string): void {
  const scripts = Array.from(
    html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
  ).filter(
    ([, attributes]) => !/type="application\/ld\+json"/.test(attributes),
  );
  const unstamped = scripts
    .filter(([, attributes]) => !attributes.includes(`nonce="${nonce}"`))
    .map(([, , body]) => body);
  expect(scripts.length).toBeGreaterThan(3);
  expect(unstamped).toEqual([THEME_INIT_SCRIPT]);
  for (const [preload] of html.matchAll(/<link\b[^>]*\bas="script"[^>]*>/g)) {
    expect(preload).toContain(`nonce="${nonce}"`);
  }
}

test.describe("s79 content security policy", () => {
  test("the marketing surface stays static and enters the app through a nonce document", async ({
    page,
    request,
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

    // A direct request establishes the app policy we expect the normal
    // homepage CTA to establish too. Before this repair Next's client Link
    // changed the route without replacing the marketing document, so the tab
    // kept `'unsafe-inline'` for the credential page.
    const directSignup = await request.get("/signup");
    const directSignupNonce = nonceOf(
      directSignup.headers()["content-security-policy"],
    );
    expect(directSignupNonce).toBeTruthy();

    await page.goto("/", { waitUntil: "load" });
    expect(await inlineHandlerRuns(page)).toBe(true);

    const signupDocuments: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        response.request().resourceType() === "document" &&
        url.pathname === "/signup"
      ) {
        signupDocuments.push(
          response.headers()["content-security-policy"] ?? "",
        );
      }
    });

    await page
      .getByRole("link", { name: "Start your free trial", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/signup$/);

    expect(await inlineHandlerRuns(page)).toBe(false);
    expect(signupDocuments).toHaveLength(1);
    const linkedSignupNonce = nonceOf(signupDocuments[0]);
    expect(linkedSignupNonce).toBeTruthy();
    expect(linkedSignupNonce).not.toBe(directSignupNonce);

    // Once inside the nonce surface, its ordinary client navigation remains
    // useful and safe: /signup -> /login changes the app route without another
    // document request, retaining the nonce policy already installed.
    const appInternalDocuments: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "document") {
        appInternalDocuments.push(new URL(response.url()).pathname);
      }
    });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(appInternalDocuments).toEqual([]);
    expect(await inlineHandlerRuns(page)).toBe(false);

    // The shared Header used to open LoginForm/SignupForm directly inside the
    // static marketing document. Its visible Sign in action now crosses the
    // same document boundary as the Hero CTA.
    const directLogin = await request.get("/login");
    const directLoginNonce = nonceOf(
      directLogin.headers()["content-security-policy"],
    );
    expect(directLoginNonce).toBeTruthy();

    await page.goto("/", { waitUntil: "load" });
    const loginDocuments: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        response.request().resourceType() === "document" &&
        url.pathname === "/login"
      ) {
        loginDocuments.push(
          response.headers()["content-security-policy"] ?? "",
        );
      }
    });

    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(loginDocuments).toHaveLength(1);
    const linkedLoginNonce = nonceOf(loginDocuments[0]);
    expect(linkedLoginNonce).toBeTruthy();
    expect(linkedLoginNonce).not.toBe(directLoginNonce);
    expect(await inlineHandlerRuns(page)).toBe(false);
  });

  for (const path of ["/login", "/signup", "/edit"]) {
    test(`the app surface: ${path} stamps a fresh nonce on every Next script, its 404 included`, async ({
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

      expectEveryNextScriptStamped(await first.text(), nonce ?? "");

      const violations = await watchScriptViolations(page);
      await page.goto(path, { waitUntil: "load" });
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);

      // s79 review F1: a URL under the segment that matches no page used to
      // get the prebuilt, nonce-less /_not-found under this policy — every
      // script refused, a 404 that never hydrated. It renders per request now.
      // Streamed after the root `loading.tsx` shell, `notFound()` can no
      // longer set the status, so Next answers 200 and writes a `noindex`
      // robots meta instead (as it already did for an unknown /blog/[slug]).
      // Either status is accepted; the noindex is not optional (ADR 059).
      const missingPath = `${path}/no-such-page`;
      const missing = await request.get(missingPath);
      const missingHtml = await missing.text();
      const missingNonce = nonceOf(
        missing.headers()["content-security-policy"],
      );
      expect([200, 404]).toContain(missing.status());
      expect(missingHtml).toContain('<meta name="robots" content="noindex"/>');
      expect(missingNonce).toBeTruthy();
      expectEveryNextScriptStamped(missingHtml, missingNonce ?? "");

      await page.goto(missingPath, { waitUntil: "load" });
      await expect(
        page.getByText("Page not found", { exact: true }),
      ).toBeVisible();
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

      await page.goto(`/dashboard/sites/${owner.siteId}`, {
        waitUntil: "load",
      });
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);

      // s79 review F1: a signed-in owner's mistyped dashboard URL renders its
      // 404 per request, under the nonce, and hydrates (the policy is checked
      // with the other dashboard documents below).
      await page.goto("/dashboard/no-such-page", { waitUntil: "load" });
      await expect(
        page.getByText("Page not found", { exact: true }),
      ).toBeVisible();
      await expect.poll(() => isHydrated(page)).toBe(true);
      expect(await violations()).toEqual([]);

      expect(dashboardPolicies.length).toBeGreaterThanOrEqual(3);
      for (const policy of dashboardPolicies) {
        expect(nonceOf(policy)).toBeTruthy();
      }
    });
  });
});
