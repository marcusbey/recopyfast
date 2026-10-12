/**
 * An esbuild bundle of `safe-fetch.ts` for tests that must run it in a CHILD
 * `node` process (a proxy environment, a real Sentry SDK). tsx itself talks
 * HTTP to its own helper, so the child runs plain `node` on this bundle.
 *
 * `@sentry/*` stays external and resolves from the repository's node_modules
 * (NODE_PATH): the child's own `@sentry/node` and the bundle's Sentry import
 * must be ONE instance, or the bundle's `suppressTracing` would talk to a
 * second, uninitialised SDK.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSync } from "esbuild";

export interface SafeFetchBundle {
  /** The bundle's path, to `require` in the child. */
  bundle: string;
  /** The child's working directory. */
  workDir: string;
  /** NODE_PATH for the child, so `@sentry/*` resolves from the repository. */
  nodePath: string;
  cleanup(): void;
}

export function bundleSafeFetch(): SafeFetchBundle {
  const root = path.resolve(__dirname, "../../../../..");
  const workDir = mkdtempSync(path.join(tmpdir(), "rcf-safe-fetch-"));
  const bundle = path.join(workDir, "safe-fetch.cjs");
  buildSync({
    entryPoints: [path.join(root, "src/lib/tools/fetch/safe-fetch.ts")],
    tsconfig: path.join(root, "tsconfig.json"),
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    external: ["@sentry/*"],
    logLevel: "error",
  });
  return {
    bundle,
    workDir,
    nodePath: path.join(root, "node_modules"),
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}
