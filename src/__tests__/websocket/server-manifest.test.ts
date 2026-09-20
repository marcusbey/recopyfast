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
const SERVER_SECURITY_WORKFLOW = path.resolve(
  SERVER_DIR,
  "../.github/workflows/server-security.yml",
);

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

  const lock = JSON.parse(
    fs.readFileSync(path.join(SERVER_DIR, "package-lock.json"), "utf8"),
  ) as {
    packages?: Record<
      string,
      {
        dependencies?: Record<string, string>;
        version?: string;
      }
    >;
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

  it("has a patched lockfile that agrees with the manifest and is CI-gated", () => {
    // `npm ci` (Dockerfile:16) refuses to run against a lockfile that does not
    // match package.json — it does not silently resolve, it exits non-zero. A
    // hand-edited manifest therefore breaks the build rather than the runtime.
    const rootEntry = lock.packages?.[""];
    expect(rootEntry?.dependencies).toEqual(manifest.dependencies);

    // In September 2026 the root audit stayed green while this separately
    // deployed lock still resolved Express 4.22.2 -> body-parser 1.20.6 ->
    // qs 6.15.3. Both active qs advisories were only moderate, so a high-only
    // gate missed them. Pin the compatible Express 4 floor and its reviewed
    // transitive resolution here so regenerating this independent lock cannot
    // silently restore the vulnerable tree.
    expect(manifest.dependencies?.express).toBe("^4.22.3");
    expect(lock.packages?.["node_modules/express"]?.version).toBe("4.22.3");
    expect(lock.packages?.["node_modules/body-parser"]?.version).toBe("1.20.8");
    expect(lock.packages?.["node_modules/qs"]?.version).toBe("6.16.0");

    expect(fs.existsSync(SERVER_SECURITY_WORKFLOW)).toBe(true);
    const workflow = fs.readFileSync(SERVER_SECURITY_WORKFLOW, "utf8");
    expect(workflow).toMatch(/\bpush:/);
    expect(workflow).toMatch(/\bpull_request:/);
    expect(workflow).toContain('node-version: "24.14.0"');
    expect(workflow).toContain("run: npm ci --omit=dev");
    expect(workflow).toContain(
      "run: npm audit --omit=dev --audit-level=moderate",
    );
    expect(workflow.match(/working-directory: server/g)).toHaveLength(2);
    expect(workflow).not.toContain("continue-on-error:");
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
