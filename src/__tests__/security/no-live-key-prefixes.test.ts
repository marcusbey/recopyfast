/**
 * @jest-environment node
 */

/**
 * s79 (s69 L19) — no Stripe live-key material in the repository, not even a
 * truncated prefix.
 *
 * `docs/operations/deployment-checklist.md` carried the first characters of
 * the real `sk_live_` and `pk_live_` keys, i.e. the account id. Not a usable
 * secret on its own (the publishable key, which shares it, is served to every
 * browser) — but this repository is public, and a "truncated" key in a doc is
 * the template the next person fills in completely.
 *
 * A real Stripe key reads `<sk|pk|rk>_live_5<digit>…`; the CI placeholders
 * (`pk_live_placeholder…`, `pk_live_local_e2e_placeholder`) and the unit-test
 * fixture `sk_live_supersecret` do not, which is what keeps this guard quiet on
 * them without an allowlist.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const TEXT_FILE =
  /\.(md|mdx|ts|tsx|js|mjs|cjs|json|ya?ml|sql|toml|txt|html|css|sh)$|(^|\/)\.env\.example$/;

const LIVE_KEY = /\b(?:sk|pk|rk)_live_5\d[A-Za-z0-9]{6,}/;

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => TEXT_FILE.test(file))
    .filter((file) => !file.endsWith("package-lock.json"));
}

describe("live Stripe key material", () => {
  it("recognises a real key's shape and not the placeholders", () => {
    // Assembled at runtime: written out whole, these lines would be the
    // offenders the second test reports once this file is tracked.
    const realShape = (kind: string) => `${kind}_live_` + "51ExampleOnly0";
    expect(LIVE_KEY.test(`${realShape("sk")}...`)).toBe(true);
    expect(LIVE_KEY.test(realShape("pk"))).toBe(true);
    expect(LIVE_KEY.test("sk_live_...")).toBe(false);
    expect(LIVE_KEY.test("pk_live_placeholder0000000000")).toBe(false);
    expect(LIVE_KEY.test("pk_live_local_e2e_placeholder")).toBe(false);
    expect(LIVE_KEY.test("sk_live_supersecret")).toBe(false);
  });

  it("appears in no tracked file", () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) => {
      let source: string;
      try {
        source = readFileSync(path.join(ROOT, file), "utf8");
      } catch {
        return []; // deleted in the working tree
      }
      return source
        .split("\n")
        .flatMap((line, index) =>
          LIVE_KEY.test(line) ? [`${file}:${index + 1}`] : [],
        );
    });

    expect(offenders).toEqual([]);
  });
});
