/**
 * @jest-environment node
 *
 * s66a AC 3 — one radius scale for the app (ADR 050).
 *
 * The owner asked for "straight and clean" (2026-10-07). Research counted 196
 * `rounded*` occurrences across 67 reachable app files, at six live values
 * from 4 px to 22 px, plus pills. Squaring the primitives fixes what people
 * see today; nothing stops the next component from typing `rounded-xl` again.
 * This guard is that something.
 *
 * Two halves:
 * - the tokens: `--radius-control` ≤ 2 px and `--radius-container` = 0 in
 *   `@theme inline`;
 * - a scan of every app-surface file (see ./app-surface.ts) for the legacy
 *   scale, against a per-file baseline of today's offenders that may only
 *   shrink. s66b empties it. `src/components/ui/**` and the two redesigned
 *   panels hold zero from s66a.
 *
 * Regenerate the baseline (only ever to lower it) with
 * `RCF_WRITE_RADIUS_BASELINE=1 npx jest src/__tests__/design/radius-guard`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  appSurfaceFiles,
  baseUtility,
  excludedFiles,
  importSpecifiers,
  importsOfExcludedFiles,
  isExcluded,
  readSource,
  resolveImport,
  stripComments,
} from "./app-surface";

const BASELINE_PATH = path.join(__dirname, "radius-baseline.json");
const GLOBALS_CSS = path.join(REPO_ROOT, "src/app/globals.css");

/** Files that must hold zero offences, so they never enter the baseline. */
const MUST_BE_ZERO = [
  /^src\/components\/ui\//,
  /^src\/components\/dashboard\/SiteRegistrationModal\.tsx$/,
  /^src\/components\/dashboard\/ShareSiteDialog\.tsx$/,
  /^src\/components\/dashboard\/ShareLinkCard\.tsx$/,
];

const AVATAR = "src/components/ui/avatar.tsx";

/** Side and corner forms: `t`, `tl`, `s`, `ee` … (Tailwind's logical sides). */
const SIDE = "(?:-(?:[trbl]{1,2}|[se]{1,2}))?";
const BARE = new RegExp(`^rounded${SIDE}$`);
const LEGACY = new RegExp(`^rounded${SIDE}-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)$`);
const ARBITRARY = new RegExp(`^rounded${SIDE}-\\[([^\\]]+)\\]$`);
const FULL = new RegExp(`^rounded${SIDE}-full$`);
const MAX_CONTROL_PX = 2;

interface RadiusOffence {
  line: number;
  rule: string;
  token: string;
}

function toPixels(value: string): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * 16 : amount;
}

/**
 * A `rounded-full` that is allowed: a spinner, the pulse ring of a status
 * dot, a dot of at most 8 px (h/w 1, 1.5 or 2), or the Avatar primitive.
 */
function isRoundExceptionAllowed(classString: string, file: string): boolean {
  if (file === AVATAR) return true;
  const tokens = classString.split(/[\s"'`{}()$,;]+/).map(baseUtility);
  if (tokens.some((token) => /^animate-(spin|ping)$/.test(token))) return true;
  const small = /^(1|1\.5|2)$/;
  const height = tokens.some(
    (token) => /^h-/.test(token) && small.test(token.slice(2)),
  );
  const width = tokens.some(
    (token) => /^w-/.test(token) && small.test(token.slice(2)),
  );
  return height && width;
}

function classifyToken(token: string): string | null {
  if (BARE.test(token)) return "bare rounded (a literal 4px, not a token)";
  if (LEGACY.test(token))
    return "legacy radius scale (use rounded-control / rounded-container)";
  const arbitrary = token.match(ARBITRARY);
  if (arbitrary) {
    const pixels = toPixels(arbitrary[1]);
    return pixels === null || pixels > MAX_CONTROL_PX
      ? "arbitrary radius above 2px"
      : null;
  }
  if (FULL.test(token)) return "rounded-full";
  return null;
}

/** String literals on one line, with their spans. */
function literalSpans(line: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of line.matchAll(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g,
  )) {
    spans.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return spans;
}

/** Every radius offence in one source file. Pure, so the rules self-test. */
function findRadiusOffences(source: string, file: string): RadiusOffence[] {
  const offences: RadiusOffence[] = [];
  const isTsx = file.endsWith(".tsx");
  const lines = stripComments(source).split("\n");

  lines.forEach((text, index) => {
    const line = index + 1;

    if (isTsx) {
      for (const match of text.matchAll(/borderRadius|border-radius/g)) {
        offences.push({ line, rule: "inline border-radius", token: match[0] });
      }
    }

    const spans = literalSpans(text);
    for (const match of text.matchAll(
      /[^\s"'`{}(),;$]*rounded[^\s"'`{}(),;$]*/g,
    )) {
      const token = baseUtility(match[0]);
      const rule = classifyToken(token);
      if (!rule) continue;

      if (rule === "rounded-full") {
        const at = match.index ?? 0;
        const span = spans.find(
          (candidate) => at >= candidate.start && at < candidate.end,
        );
        const classString = span ? text.slice(span.start, span.end) : text;
        if (isRoundExceptionAllowed(classString, file)) continue;
        offences.push({
          line,
          rule: "rounded-full outside the exceptions",
          token,
        });
        continue;
      }

      offences.push({ line, rule, token });
    }
  });

  return offences;
}

type Baseline = Record<string, number>;

function currentCounts(): Map<string, RadiusOffence[]> {
  const counts = new Map<string, RadiusOffence[]>();
  for (const file of appSurfaceFiles()) {
    const offences = findRadiusOffences(readSource(file), file);
    if (offences.length > 0) counts.set(file, offences);
  }
  return counts;
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

if (process.env.RCF_WRITE_RADIUS_BASELINE === "1") {
  const counts = currentCounts();
  const baseline: Baseline = {};
  for (const [file, offences] of counts) {
    if (MUST_BE_ZERO.some((pattern) => pattern.test(file))) continue;
    baseline[file] = offences.length;
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function themeToken(css: string, name: string): string | null {
  const theme = css.match(/@theme inline\s*{([\s\S]*?)\n}/);
  if (!theme) return null;
  const declaration = theme[1].match(new RegExp(`${name}:\\s*([^;]+);`));
  return declaration ? declaration[1].trim() : null;
}

describe("the scanned app surface", () => {
  it("scans the reachable app and excludes only the listed dead code", () => {
    const scanned = appSurfaceFiles();
    expect(scanned).toContain("src/components/ui/dialog.tsx");
    expect(scanned).toContain("src/app/dashboard/sites/page.tsx");
    expect(scanned).toContain(
      "src/components/dashboard/SiteRegistrationModal.tsx",
    );
    expect(excludedFiles()).toContain(
      "src/components/dashboard/SecurityDashboard.tsx",
    );
    expect(scanned).not.toContain(
      "src/components/dashboard/SecurityDashboard.tsx",
    );
  });

  // An excluded file is excluded because nothing reachable imports it. The
  // day a scanned file does, it is reachable again and must be scanned.
  it("fails if a scanned file imports an excluded one", () => {
    expect(importsOfExcludedFiles()).toEqual([]);
  });

  it("resolves the imports that check relies on (not vacuously empty)", () => {
    // `_ab-tests/page.tsx` is excluded itself, so its imports of other
    // excluded files are allowed; they prove the resolver finds them.
    const page = "src/app/dashboard/_ab-tests/page.tsx";
    const targets = importSpecifiers(readSource(page))
      .map((specifier) => resolveImport(page, specifier))
      .filter((target): target is string => target !== null);
    expect(targets).toContain("src/components/dashboard/SiteSelectorBar.tsx");
    expect(targets.filter(isExcluded).length).toBeGreaterThan(1);
  });
});

describe("radius tokens (ADR 050)", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");

  it("defines --radius-control at 2px or less", () => {
    const value = themeToken(css, "--radius-control");
    expect(value).not.toBeNull();
    const pixels = toPixels(value as string);
    expect(pixels).not.toBeNull();
    expect(pixels as number).toBeGreaterThan(0);
    expect(pixels as number).toBeLessThanOrEqual(MAX_CONTROL_PX);
  });

  it("defines --radius-container at 0", () => {
    const value = themeToken(css, "--radius-container");
    expect(value).not.toBeNull();
    expect(toPixels(value as string)).toBe(0);
  });
});

describe("radius scan of the app surface", () => {
  it("finds no offence beyond a file's baseline", () => {
    const baseline = readBaseline();
    const report: string[] = [];
    for (const [file, offences] of currentCounts()) {
      const allowed = baseline[file] ?? 0;
      if (offences.length <= allowed) continue;
      report.push(
        `${file}: ${offences.length} offences, baseline ${allowed}`,
        ...offences.map(
          (offence) =>
            `  ${file}:${offence.line} ${offence.rule} \`${offence.token}\``,
        ),
      );
    }
    expect(report).toEqual([]);
  });

  it("only ever shrinks: a file below its baseline must lower it", () => {
    const counts = currentCounts();
    const stale = Object.entries(readBaseline())
      .filter(([file, allowed]) => (counts.get(file)?.length ?? 0) < allowed)
      .map(
        ([file, allowed]) =>
          `${file}: baseline ${allowed}, now ${counts.get(file)?.length ?? 0} — lower the entry in radius-baseline.json (delete it at 0)`,
      );
    expect(stale).toEqual([]);
  });

  it("holds ui/** and the two redesigned panels at zero", () => {
    const entries = Object.keys(readBaseline()).filter((file) =>
      MUST_BE_ZERO.some((pattern) => pattern.test(file)),
    );
    expect(entries).toEqual([]);
  });
});

describe("radius rules (self-test)", () => {
  const rulesFor = (source: string, file = "src/components/dashboard/X.tsx") =>
    findRadiusOffences(source, file).map((offence) => offence.rule);

  it.each([
    [
      '<div className="rounded p-2" />',
      "bare rounded (a literal 4px, not a token)",
    ],
    [
      '<div className="flex-1 rounded-t" />',
      "bare rounded (a literal 4px, not a token)",
    ],
    [
      '<div className="rounded-lg border" />',
      "legacy radius scale (use rounded-control / rounded-container)",
    ],
    [
      '<div className="sm:rounded-tl-xl" />',
      "legacy radius scale (use rounded-control / rounded-container)",
    ],
    [
      '<div className="rounded-4xl" />',
      "legacy radius scale (use rounded-control / rounded-container)",
    ],
    ['<div className="rounded-[6px]" />', "arbitrary radius above 2px"],
    ['<div className="rounded-[0.5rem]" />', "arbitrary radius above 2px"],
    [
      '<div className="h-8 w-8 rounded-full bg-muted" />',
      "rounded-full outside the exceptions",
    ],
    [
      '<div className="h-5 w-[2px] rounded-r-full" />',
      "rounded-full outside the exceptions",
    ],
    ["<div style={{ borderRadius: 8 }} />", "inline border-radius"],
    ["const css = `border-radius: 8px;`;", "inline border-radius"],
  ])("fires on %s", (source, rule) => {
    expect(rulesFor(source)).toEqual([rule]);
  });

  it.each([
    '<div className="rounded-control border" />',
    '<div className="rounded-container border" />',
    '<div className="rounded-none" />',
    '<div className="rounded-[2px]" />',
    '<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />',
    '<span className="h-2 w-2 rounded-full" />',
    '<div className="animate-spin rounded-full h-12 w-12" />',
    '<span className="absolute h-full w-full animate-ping rounded-full" />',
    "// rounded boxes nest inside a rounded-xl modal",
    "{/* was rounded-2xl */}",
    "/* border-radius: 8px */",
  ])("stays quiet on %s", (source) => {
    expect(rulesFor(source)).toEqual([]);
  });

  it("allows rounded-full in the Avatar primitive only", () => {
    const source = '<span className="h-10 w-10 rounded-full" />';
    expect(rulesFor(source, AVATAR)).toEqual([]);
    expect(rulesFor(source)).toEqual(["rounded-full outside the exceptions"]);
  });

  it("checks inline radius in TSX only", () => {
    expect(rulesFor("const s = 'border-radius: 4px';", "src/lib/x.ts")).toEqual(
      [],
    );
  });

  it("reports the line of the offence", () => {
    const offences = findRadiusOffences(
      '\n\n<div className="rounded-md" />',
      "src/components/dashboard/X.tsx",
    );
    expect(offences.map((offence) => offence.line)).toEqual([3]);
  });
});
