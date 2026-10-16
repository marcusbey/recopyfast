/**
 * s107 — "Cookie settings" is an event the analytics runtime listens for, in a
 * module with no imports so the footer that dispatches it pulls nothing else
 * into every page's critical chunk.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  openCookieSettings,
} from "@/lib/analytics/google-analytics/cookie-settings";

describe("openCookieSettings", () => {
  it("dispatches the event the runtime listens for", () => {
    const listener = jest.fn();
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, listener);

    openCookieSettings();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, listener);
  });

  it("imports nothing, and the footer imports nothing heavier", () => {
    const root = process.cwd();
    const source = readFileSync(
      path.join(root, "src/lib/analytics/google-analytics/cookie-settings.ts"),
      "utf8",
    );
    const footer = readFileSync(
      path.join(root, "src/components/layout/Footer.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^import /m);
    expect(footer).not.toMatch(/google-analytics\/gtag"/);
  });
});
