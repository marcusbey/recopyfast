/**
 * @jest-environment node
 */

/**
 * s107 — Google Analytics never travels inside code we run on other people's
 * pages: the embed widget (every customer site) and the /try runtime (any
 * page a visitor bookmarklets). Those scripts are served from our origin but
 * execute on third-party documents, where our consent banner, our privacy
 * page and our CSP do not apply. A tripwire on the shipped files.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const THIRD_PARTY_SCRIPTS = [
  "public/embed/recopyfast.src.js",
  "public/embed/recopyfast.js",
  "public/embed/recopyfast-secure.js",
  "public/try/rcf-try.js",
];

const ANALYTICS_MARKERS = [
  /googletagmanager/i,
  /google-analytics/i,
  /analytics\.google/i,
  /gtag\s*\(/,
  /dataLayer/,
  /gtag-init/,
];

describe("scripts that run on third-party pages", () => {
  it.each(THIRD_PARTY_SCRIPTS)("%s carries no analytics", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");

    for (const marker of ANALYTICS_MARKERS) {
      expect([file, marker.source, marker.test(source)]).toEqual([
        file,
        marker.source,
        false,
      ]);
    }
  });
});
