import type { Page } from "@playwright/test";

/**
 * CSP helpers shared by the browser specs: the s79 script-violation watcher
 * and the hydration probe, moved here unchanged from e2e/csp.spec.ts by s96 so
 * e2e/tools.spec.ts asserts the same two signals.
 *
 * Only script directives are counted: CI serves the production build from
 * http://127.0.0.1, where the unchanged `connect-src` (https/wss only in
 * production) refuses the local Supabase — an artefact of the stack, not of
 * the policy under test.
 */

const SCRIPT_DIRECTIVE = /script-src/;

export async function watchScriptViolations(
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
export async function isHydrated(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("body *")).some((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactFiber$")),
    ),
  );
}
