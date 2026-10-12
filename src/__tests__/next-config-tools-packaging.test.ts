/**
 * @jest-environment node
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import nextConfig from "../../next.config";

/**
 * s96 — the Typo Finder's dictionary reaches the scan function on Vercel.
 *
 * `wordlist-english` reads its JSON files at runtime through a `__dirname`
 * trick (`expose.js`), which a bundler cannot follow: bundled, the function
 * would ship without the word lists and fail its first scan in production
 * only. So the package stays a runtime `require` (`serverExternalPackages`),
 * and its data files and SCOWL notice are traced into the scan route
 * explicitly. The build output's `.nft.json` for the route is checked by hand
 * before review (docs/reviews/s96-free-tools-platform.md).
 */

const SCAN_ROUTE = "/api/tools/scan";

describe("free-tools packaging", () => {
  it("keeps wordlist-english a runtime require", () => {
    expect(nextConfig.serverExternalPackages).toContain("wordlist-english");
  });

  it("traces the word lists and the SCOWL copyright notice into the scan route", () => {
    expect(nextConfig.outputFileTracingIncludes?.[SCAN_ROUTE]).toEqual([
      "./node_modules/wordlist-english/*.json",
      "./node_modules/wordlist-english/Copyright",
    ]);
  });

  it("those globs match real files in the installed package", () => {
    const directory = path.join(process.cwd(), "node_modules/wordlist-english");
    const lists = readdirSync(directory).filter((file) =>
      file.endsWith(".json"),
    );

    // 5 dialects × 8 size bands, plus package.json.
    expect(lists.length).toBeGreaterThanOrEqual(40);
    expect(existsSync(path.join(directory, "Copyright"))).toBe(true);
  });
});
