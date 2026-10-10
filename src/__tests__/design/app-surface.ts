/**
 * The app surface the s66a design guards scan, in one place.
 *
 * Three source-scan tests (radius, dialog structure, native selects) need the
 * same answer to "which files are the app", and three copies of a root list
 * drift the way the five hand-written <select> class strings did (ADR 051).
 *
 * Roots: the signed-in app and its auth pages, plus the component folders they
 * compose. Marketing (`src/app/{page,compare,docs,blog,try,…}`,
 * `src/components/{landing,sections,layout,…}`) keeps the legacy radius scale by
 * ADR 050 and is deliberately absent.
 *
 * This is a helper, not a suite: jest's `testMatch` only collects `*.test.*`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = process.cwd();

export const SCANNED_ROOTS = [
  "src/app/dashboard",
  "src/app/settings",
  "src/app/login",
  "src/app/signup",
  "src/app/auth",
  "src/app/edit",
  "src/components/ui",
  "src/components/dashboard",
  "src/components/auth",
  "src/components/settings",
  "src/components/billing",
  "src/components/shared",
] as const;

/**
 * Unreachable code inside the scanned roots. Every entry has no importer from a
 * reachable file (s66 research, "Dead code"); deleting it is the dead-code
 * chore the research splits out ("Real complexity and split": orphan cleanup),
 * not a design pass. Excluding them keeps the guards about what a person can
 * see, and the importer check below fails the day one of them is wired back in.
 */
const UNREACHABLE_EXCLUSIONS: ReadonlyArray<{
  matches: (relativePath: string) => boolean;
  reason: string;
}> = [
  {
    // Next private folder: `_ab-tests` is not a route.
    matches: (file) => file.startsWith("src/app/dashboard/_ab-tests/"),
    reason: "private folder, not routed (dead-code chore)",
  },
  {
    // The A/B test family: ABTest*.tsx plus the ab-create/ and ab-results/
    // folders. Only `_ab-tests/page.tsx` imports them.
    matches: (file) =>
      /^src\/components\/dashboard\/(ab-[^/]+\/|ABTest[^/]*\.tsx$)/.test(file),
    reason: "A/B components, only imported by _ab-tests (dead-code chore)",
  },
  {
    matches: (file) =>
      file === "src/components/dashboard/SecurityDashboard.tsx",
    reason: "no importer, frozen by s04 (dead-code chore)",
  },
  {
    matches: (file) =>
      file === "src/components/dashboard/TranslationDashboard.tsx",
    reason: "no importer (dead-code chore)",
  },
  {
    matches: (file) => file === "src/components/dashboard/SiteSelectorBar.tsx",
    reason: "only imported by _ab-tests (dead-code chore)",
  },
];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function toRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (
      SOURCE_EXTENSIONS.includes(path.extname(entry.name)) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      files.push(toRelative(absolute));
    }
  }
  return files;
}

function allRootFiles(): string[] {
  return SCANNED_ROOTS.flatMap((root) =>
    walk(path.join(REPO_ROOT, root)),
  ).sort();
}

export function isExcluded(relativePath: string): boolean {
  return UNREACHABLE_EXCLUSIONS.some((rule) => rule.matches(relativePath));
}

/** Every reachable app-surface source file, repo-relative, sorted. */
export function appSurfaceFiles(): string[] {
  return allRootFiles().filter((file) => !isExcluded(file));
}

/** The excluded files that exist today, repo-relative, sorted. */
export function excludedFiles(): string[] {
  return allRootFiles().filter(isExcluded);
}

export function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * Replaces comments with spaces, keeping every newline, so a scan reads code
 * only and still reports the right line. The house style is long comments
 * that name the bug they prevent, which routinely quote the very classes and
 * tags the guards forbid ("rounded boxes nest inside a rounded modal").
 *
 * String and template literals are skipped over, so `https://` inside a
 * string is not mistaken for a comment.
 */
export function stripComments(source: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      output += source.slice(index, stop).replace(/[^\n]/g, " ");
      index = stop;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

/** Every module specifier a file imports: static, side-effect and dynamic. */
export function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  for (const pattern of [
    /\bimport\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bexport\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves `@/…` and relative specifiers to a repo-relative source file. */
export function resolveImport(
  fromFile: string,
  specifier: string,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(REPO_ROOT, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(
      path.join(REPO_ROOT, path.dirname(fromFile)),
      specifier,
    );
  } else {
    return null;
  }

  for (const candidate of [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return toRelative(candidate);
    }
  }
  return null;
}

/** Scanned files that import an excluded one: each is a resurrection. */
export function importsOfExcludedFiles(): string[] {
  const excluded = new Set(excludedFiles());
  return appSurfaceFiles().flatMap((file) =>
    importSpecifiers(readSource(file))
      .map((specifier) => resolveImport(file, specifier))
      .filter((target): target is string => !!target && excluded.has(target))
      .map((target) => `${file} imports ${target}`),
  );
}

/**
 * Strips Tailwind variant prefixes (`sm:`, `hover:`, `data-[state=open]:`,
 * `[&>*]:`) from a class token. Colons inside brackets are not separators.
 */
export function baseUtility(token: string): string {
  let depth = 0;
  let lastSeparator = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) lastSeparator = index;
  }
  return token.slice(lastSeparator + 1).replace(/^!/, "");
}
