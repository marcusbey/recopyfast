/**
 * s04 AC3 — no dashboard route renders a graveyard collaboration surface.
 *
 * `TeamSelector`, `InvitationManager`, `NotificationCenter` and
 * `SecurityDashboard` are frozen, not deleted: the PRD's graveyard says teams
 * with org roles, the notification centre and the security events dashboard
 * stay built and stay unexposed, so an agency asking for real teams later is a
 * re-wiring job rather than a rewrite (`docs/prd.md`, "Explicitly NOT
 * replicated").
 *
 * Freezing a component is not a state the type system or the linter can hold.
 * The four files still compile, still export, and are one `import` away from
 * being live again — and the import that resurrects them would look like
 * ordinary feature work in review. This test is the only thing standing between
 * "unexposed" and "someone wired it back in on a Friday".
 *
 * It scans the real `src/app/` tree rather than asserting on a snapshot of it,
 * so a new route added tomorrow is covered the day it is written.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.join(process.cwd(), "src", "app");

/** The four surfaces the PRD froze. Named exports and file names both. */
const FROZEN_COMPONENTS = [
  "TeamSelector",
  "InvitationManager",
  "NotificationCenter",
  "SecurityDashboard",
] as const;

/**
 * Every `import ... from "..."` statement and every `import("...")` call in a
 * source file, as raw text.
 *
 * Matching the whole statement rather than parsing bindings catches all three
 * shapes that can resurrect a component: a named import, a default import, and
 * a `next/dynamic` lazy import whose module path carries the name while no
 * binding does.
 */
function importStatements(source: string): string[] {
  const statements: string[] = [];

  // Static: `import ... from "path"` (multi-line specifier lists included).
  for (const match of source.matchAll(
    /\bimport\s[\s\S]*?\sfrom\s*["'][^"']+["']/g,
  )) {
    statements.push(match[0]);
  }

  // Side-effect only: `import "path"`.
  for (const match of source.matchAll(/\bimport\s*["'][^"']+["']/g)) {
    statements.push(match[0]);
  }

  // Dynamic: `import("path")`, including inside `dynamic(() => ...)`.
  for (const match of source.matchAll(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g)) {
    statements.push(match[0]);
  }

  return statements;
}

/** The frozen components a file imports, by any of the three shapes above. */
function frozenImportsIn(source: string): string[] {
  const statements = importStatements(source);
  return FROZEN_COMPONENTS.filter((component) =>
    statements.some((statement) => statement.includes(component)),
  );
}

/** Every route/layout/component source under `src/app/`, tests excluded. */
function routeSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...routeSourceFiles(full));
      continue;
    }
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }

  return files;
}

describe("graveyard collaboration components are unreachable from src/app", () => {
  const files = routeSourceFiles(APP_DIR);

  // GUARD. Every assertion below is an absence, so a scanner that walked
  // nothing, or a matcher that matches nothing, would pass forever while the
  // components were being imported on every page.
  it("scans a real, populated app tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.some((file) => file.endsWith("dashboard/sites/page.tsx")),
    ).toBe(true);
  });

  // GUARD. Proves the matcher catches each shape a resurrection could take.
  it.each([
    [
      "a named import",
      `import { TeamSelector } from "@/components/collaboration/TeamSelector";`,
      "TeamSelector",
    ],
    [
      "a default import",
      `import SecurityDashboard from "@/components/dashboard/SecurityDashboard";`,
      "SecurityDashboard",
    ],
    [
      "a multi-line specifier list",
      `import {\n  Card,\n  NotificationCenter,\n} from "@/components/collaboration/NotificationCenter";`,
      "NotificationCenter",
    ],
    [
      "a next/dynamic lazy import",
      `const M = dynamic(() => import("@/components/collaboration/InvitationManager"));`,
      "InvitationManager",
    ],
  ])("detects %s", (_shape, source, expected) => {
    expect(frozenImportsIn(source)).toEqual([expected]);
  });

  it("ignores a mention that is not an import", () => {
    // A comment naming the frozen surface — exactly what this repo's house
    // style asks for — must not be mistaken for wiring it back in.
    expect(
      frozenImportsIn(
        `// TeamSelector stays frozen; see docs/prd.md.\nconst label = "SecurityDashboard";`,
      ),
    ).toEqual([]);
  });

  it("imports none of the frozen components anywhere under src/app", () => {
    const offenders = files
      .map((file) => ({
        file: path.relative(process.cwd(), file),
        imported: frozenImportsIn(readFileSync(file, "utf8")),
      }))
      .filter((entry) => entry.imported.length > 0);

    expect(offenders).toEqual([]);
  });
});
