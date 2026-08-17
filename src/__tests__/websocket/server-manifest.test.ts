/**
 * @jest-environment node
 */

/**
 * T1 — `server/` must be installable and runnable from its own manifest.
 *
 * `server/Dockerfile:16` runs `npm ci --omit=dev` against `server/package.json`
 * alone, and `server/.dockerignore` strips the host's `node_modules`. So the
 * image contains exactly the declared dependencies and nothing else.
 *
 * That is why the process has never actually run outside a dev tree: `index.js`
 * required `dompurify` and `jsdom`, neither of which was declared. Under
 * `npm run dev` the require resolves because Node walks up from `server/` into
 * the repo-root `node_modules`, which does have both. In the container it dies
 * with `Cannot find module 'dompurify'` at load — before the crash handlers are
 * even registered, so Fly restart-loops with no useful diagnostic.
 *
 * This suite is the cheap, always-run half of that check. `docker build ./server
 * && docker run` is the other half and lives in the PR description; it is the
 * only run with `.dockerignore` actually applied.
 */

import { builtinModules } from "module";
import fs from "fs";
import path from "path";

const SERVER_DIR = path.resolve(__dirname, "../../../server");

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function serverSourceFiles(): string[] {
  return fs
    .readdirSync(SERVER_DIR)
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => path.join(SERVER_DIR, entry));
}

/** Bare module specifiers required anywhere in a file. */
function requiredPackages(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const specifiers = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith("."))
    .filter((specifier) => !BUILTINS.has(specifier));

  // "@scope/name/deep" and "name/deep" both resolve to their package root.
  return specifiers.map((specifier) => {
    const segments = specifier.split("/");
    return specifier.startsWith("@")
      ? segments.slice(0, 2).join("/")
      : segments[0];
  });
}

describe("server manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("declares every package its source requires", () => {
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));

    const undeclared = serverSourceFiles().flatMap((filePath) =>
      requiredPackages(filePath)
        .filter((packageName) => !declared.has(packageName))
        .map((packageName) => `${path.basename(filePath)} → ${packageName}`),
    );

    expect(undeclared).toEqual([]);
  });

  it("has a lockfile that agrees with the manifest", () => {
    // `npm ci` (Dockerfile:16) refuses to run against a lockfile that does not
    // match package.json — it does not silently resolve, it exits non-zero. A
    // hand-edited manifest therefore breaks the build rather than the runtime.
    const lock = JSON.parse(
      fs.readFileSync(path.join(SERVER_DIR, "package-lock.json"), "utf8"),
    ) as {
      packages?: Record<string, { dependencies?: Record<string, string> }>;
    };

    const rootEntry = lock.packages?.[""];
    expect(rootEntry?.dependencies).toEqual(manifest.dependencies);
  });

  it("carries no nested package inside the Docker build context", () => {
    // `server/server/` was a tracked, `nodemon`-only manifest that Dependabot
    // had already bumped once. `COPY . .` pulls it into the image, and the old
    // `.dockerignore` `node_modules` line matches the context root only — so
    // `server/server/node_modules` was copied in wholesale.
    expect(fs.existsSync(path.join(SERVER_DIR, "server"))).toBe(false);
  });

  it("ignores node_modules at every depth of the build context", () => {
    const dockerignore = fs.readFileSync(
      path.join(SERVER_DIR, ".dockerignore"),
      "utf8",
    );
    const patterns = dockerignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(patterns).toContain("**/node_modules");
  });
});
