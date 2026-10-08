/**
 * @jest-environment node
 *
 * s66b1 AC 3 / AC 4 — one frame per page, enforced by a test rather than a
 * reviewer (ADR 053).
 *
 * `PageHeader` existed for months, and it was a convention: Overview and Sites
 * used it, Billing hand-rolled the same h1 inside its own
 * `container mx-auto px-4` (16px off every other page's edge), Content and
 * Settings wrote a 30/700 h1, and Analytics had an h2 and no h1 at all.
 * Nothing failed when a page skipped the header. s66c now builds its site
 * pages on the same frame, so the frame is a component (`PageShell`) and this
 * scan is what makes skipping it fail:
 *
 * - R1 adoption: every routed `src/app/dashboard/**\/page.tsx` renders
 *   `<PageShell`, itself or through one listed delegate. A page that only
 *   redirects is exempt, and only while it still calls `redirect(`. The
 *   segment's `loading.tsx` and `error.tsx` render it too: Next draws each in
 *   place of the page, inside the layout, so without one a pending route or a
 *   thrown page showed no title.
 * - R2: `<PageHeader` is rendered by `ui/page-shell.tsx` and nowhere else. A
 *   second header outside the shell adds a second h1 that R3 cannot see,
 *   because the `<h1` is written inside `page-header.tsx`.
 * - R3: no `<h1` on the app surface outside `ui/page-header.tsx` and the four
 *   standalone pages (login, signup, auth error, the /edit hub), which sit
 *   outside the frame.
 * - R4: no `container` utility on the app surface. `dashboard/layout.tsx`
 *   owns width and gutters; a page container is how Billing drifted.
 * - R5 flat (s66b2 AC 2): no `surface-interactive`, `hover:shadow-*`,
 *   `group-hover:shadow-*`, `transition-shadow` or `hover:-translate-y-*`.
 *   A static `shadow-{xs,sm,md,lg,xl,2xl}` only on what floats (the dialog,
 *   menu, Select and Card primitives, the version-history sheet) and on the
 *   layout's skip link while `focus:`.
 * - R6 weight (s66b2 AC 3): no `font-bold`, `font-extrabold` or
 *   `font-black`. The app's hierarchy is 400 / 500 / 600; Analytics set its
 *   figures at 700, the last 700s a signed-in owner could see.
 *
 * Offenders that another story owns sit in PENDING, which may only shrink:
 * an entry whose file already passes its rule fails here until it is removed.
 *
 * The scan reads code, not comments or string contents. The house style is
 * long comments that quote the very tags they forbid, and
 * `SiteRegistrationModal` holds an install example whose HTML contains both
 * `<h1>` and the word "container" in a template literal.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  appSurfaceFiles,
  baseUtility,
  readSource,
  stripComments,
} from "./app-surface";

type Rule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

const PAGE_SHELL_FILE = "src/components/ui/page-shell.tsx";
const PAGE_HEADER_FILE = "src/components/ui/page-header.tsx";

/**
 * R5: the only files a static shadow may sit in, because each draws a surface
 * that floats over the page — a dialog, a menu, Select content, Card
 * `elevated` (the variant for those surfaces), the version-history sheet.
 */
const FLOATING_SHADOW_FILES: readonly string[] = [
  "src/components/ui/dialog.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/card.tsx",
  "src/components/dashboard/VersionHistoryPanel.tsx",
];

/** R5: the skip link's `focus:shadow-md`, drawn only while it is focused. */
const FOCUS_SHADOW_FILE = "src/app/dashboard/layout.tsx";

/** Routed pages, outside the private `_ab-tests` folder (not a route). */
const DASHBOARD_PAGE = /^src\/app\/dashboard\/(?:(?!_)[^/]+\/)*page\.tsx$/;

/**
 * The segment's fallbacks: what Next renders in place of a page while it is
 * pending (`loading.tsx`) or after it throws (`error.tsx`).
 */
const DASHBOARD_FALLBACK =
  /^src\/app\/dashboard\/(?:(?!_)[^/]+\/)*(?:loading|error)\.tsx$/;

/** A page that renders through one component, which then owns the frame. */
const DELEGATES: Readonly<Record<string, string>> = {
  "src/app/dashboard/analytics/page.tsx":
    "src/components/dashboard/AnalyticsDashboard.tsx",
  "src/app/dashboard/billing/page.tsx":
    "src/components/billing/BillingDashboard.tsx",
};

/** Pages that render nothing but a redirect. */
const REDIRECT_PAGES: readonly string[] = ["src/app/dashboard/teams/page.tsx"];

/** Outside the frame by ADR 053 §3: each renders its own one h1. */
const STANDALONE_H1_FILES: readonly string[] = [
  "src/app/login/page.tsx",
  "src/app/signup/page.tsx",
  "src/app/auth/error/page.tsx",
  "src/app/edit/EditorSignIn.tsx",
];

/**
 * Shrink-only, and every entry is s66c's: it owns everything under
 * `/dashboard/sites` and the site components (ADR 053, "Collision list"), and
 * removes a rule here when its file passes it:
 * - `sites/page.tsx` moves onto `PageShell` (R1, R2), and its status filter
 *   drops the `shadow-xs` on the selected segment (R5);
 * - `EditWebsiteButton` keeps `shadow-sm` on two static boxes, and
 *   `VersionTimelineItem` a hover shadow (R5);
 * - `SiteDetailView` sets the site name at 700 (R6).
 */
const PENDING: Readonly<Record<string, readonly Rule[]>> = {
  "src/app/dashboard/sites/page.tsx": ["R1", "R2", "R5"],
  "src/components/dashboard/EditWebsiteButton.tsx": ["R5"],
  "src/components/dashboard/VersionTimelineItem.tsx": ["R5"],
  "src/components/dashboard/SiteDetailView.tsx": ["R6"],
};

const CLASS_FUNCTIONS = /\b(?:cn|clsx|cx|cva|twMerge)\s*$/;

interface Literal {
  /** Index of the opening quote. */
  start: number;
  content: string;
}

interface Offence {
  file: string;
  rule: Rule;
  line: number;
  detail: string;
}

/**
 * Blanks the contents of every string and template literal (quotes and
 * newlines kept, so indexes and line numbers survive), and returns the
 * literals it found. Raw apostrophes cannot appear in JSX text here:
 * `react/no-unescaped-entities` (next/core-web-vitals) forces `&apos;`.
 */
function scanLiterals(code: string): { blanked: string; literals: Literal[] } {
  const literals: Literal[] = [];
  let blanked = "";
  let index = 0;

  while (index < code.length) {
    const char = code[index];
    if (char !== '"' && char !== "'" && char !== "`") {
      blanked += char;
      index += 1;
      continue;
    }

    const start = index;
    let content = "";
    blanked += char;
    index += 1;
    while (index < code.length && code[index] !== char) {
      const step = code[index] === "\\" ? 2 : 1;
      const piece = code.slice(index, index + step);
      content += piece;
      blanked += piece.replace(/[^\n]/g, " ");
      index += step;
    }
    blanked += code[index] ?? "";
    index += 1;
    literals.push({ start, content });
  }

  return { blanked, literals };
}

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/**
 * Whether a literal is a class list: `className="…"`, `className={…}`, or an
 * argument (at any depth) of `cn` / `clsx` / `cva` / `twMerge`. Walks out of
 * every bracket that encloses the literal, in the blanked code, so a paren
 * inside a string cannot unbalance it.
 */
function isClassContext(blanked: string, literalStart: number): boolean {
  if (/className\s*=\s*\{?\s*$/.test(blanked.slice(0, literalStart))) {
    return true;
  }
  let depth = 0;
  for (let index = literalStart - 1; index >= 0; index -= 1) {
    const char = blanked[index];
    if (char === ")" || char === "]" || char === "}") {
      depth += 1;
    } else if (char === "(" || char === "[" || char === "{") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const head = blanked.slice(0, index);
      if (char === "(" && CLASS_FUNCTIONS.test(head)) return true;
      if (char === "{" && /className\s*=\s*$/.test(head)) return true;
    }
  }
  return false;
}

/**
 * One class-like token: split on whitespace, quotes and the punctuation of a
 * `${…}` expression, so `${isOn ? "shadow-lg" : ""}` yields `shadow-lg`.
 */
const CLASS_TOKEN = /[^\s"'`{}()$,;]+/g;
const STATIC_SHADOW = /^shadow-(?:xs|sm|md|lg|xl|2xl)(?:\/\S+)?$/;
const ANY_SHADOW = /^shadow(?:-.+)?$/;
const LIFT = /^-translate-y-/;
const HEAVY_WEIGHTS: ReadonlySet<string> = new Set([
  "font-bold",
  "font-extrabold",
  "font-black",
]);

/**
 * A class token's variants and its utility, split on the colons outside
 * brackets: `sm:hover:shadow-md` is `[sm, hover]` and `shadow-md`.
 */
function splitClassToken(token: string): {
  variants: string[];
  utility: string;
} {
  const variants: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) {
      variants.push(token.slice(start, index));
      start = index + 1;
    }
  }
  return { variants, utility: token.slice(start).replace(/^!/, "") };
}

/**
 * R5 for one class token, or null. Static panels cast no shadow and never
 * move (design system, Surfaces and elevation). On the Overview,
 * `.surface-interactive` lifted every metric and site row 1px with a
 * `shadow-md` on hover, the one thing on the page that moved, and Content's
 * cards grew a shadow on hover. A static shadow belongs to what floats only.
 */
function flatnessDetail(token: string, file: string): string | null {
  const { variants, utility } = splitClassToken(token);
  const isHover = variants.includes("hover");
  const isGroupHover = variants.some((variant) =>
    /^group-hover(?:\/|$)/.test(variant),
  );

  if (utility === "surface-interactive") {
    return "`surface-interactive` (marketing's hover lift and shadow)";
  }
  if (utility === "transition-shadow") {
    return "`transition-shadow` (a shadow that animates in)";
  }
  if ((isHover || isGroupHover) && ANY_SHADOW.test(utility)) {
    return `\`${token}\` (a shadow on hover)`;
  }
  if (isHover && LIFT.test(utility)) {
    return `\`${token}\` (a lift on hover)`;
  }
  if (STATIC_SHADOW.test(utility) && !isHover && !isGroupHover) {
    if (FLOATING_SHADOW_FILES.includes(file)) return null;
    if (file === FOCUS_SHADOW_FILE && variants.includes("focus")) return null;
    return `\`${token}\` (a static shadow on something that does not float)`;
  }
  return null;
}

/** R2 to R6 for one source file. Pure, so the rules self-test. */
function findOffences(file: string, source: string): Offence[] {
  const code = stripComments(source);
  const { blanked, literals } = scanLiterals(code);
  const offences: Offence[] = [];

  if (file !== PAGE_SHELL_FILE) {
    for (const match of blanked.matchAll(/<PageHeader(?![\w$])/g)) {
      offences.push({
        file,
        rule: "R2",
        line: lineAt(code, match.index ?? 0),
        detail: "<PageHeader outside ui/page-shell.tsx",
      });
    }
  }

  if (file !== PAGE_HEADER_FILE && !STANDALONE_H1_FILES.includes(file)) {
    for (const match of blanked.matchAll(/<h1(?![\w-])/g)) {
      offences.push({
        file,
        rule: "R3",
        line: lineAt(code, match.index ?? 0),
        detail: "<h1 outside PageHeader",
      });
    }
  }

  for (const literal of literals) {
    const hasContainer = literal.content
      .split(/\s+/)
      .some((token) => baseUtility(token) === "container");
    if (hasContainer && isClassContext(blanked, literal.start)) {
      offences.push({
        file,
        rule: "R4",
        line: lineAt(code, literal.start),
        detail: "`container` utility (the layout owns width and gutters)",
      });
    }
  }

  // R5 and R6 read every token of every literal, not only class contexts:
  // their utilities are not English words (unlike `container`), and a class
  // list is as often a variable, a cva variant or a ternary inside a template
  // literal as it is a `className=` string.
  for (const literal of literals) {
    for (const match of literal.content.matchAll(CLASS_TOKEN)) {
      const token = match[0];
      const line = lineAt(code, literal.start + 1 + (match.index ?? 0));
      const flat = flatnessDetail(token, file);
      if (flat) offences.push({ file, rule: "R5", line, detail: flat });
      if (HEAVY_WEIGHTS.has(splitClassToken(token).utility)) {
        offences.push({
          file,
          rule: "R6",
          line,
          detail: `\`${token}\` (700 or more; the app's heaviest weight is 600)`,
        });
      }
    }
  }

  return offences;
}

const rendersPageShell = (source: string) =>
  /<PageShell(?![\w$])/.test(scanLiterals(stripComments(source)).blanked);

const callsRedirect = (source: string) =>
  /\bredirect\s*\(/.test(scanLiterals(stripComments(source)).blanked);

/** R1 for one routed page, given a way to read any file. */
function adoptionOffence(
  page: string,
  read: (file: string) => string,
): Offence | null {
  if (REDIRECT_PAGES.includes(page)) return null;
  if (rendersPageShell(read(page))) return null;
  const delegate = DELEGATES[page];
  if (delegate && rendersPageShell(read(delegate))) return null;
  return {
    file: page,
    rule: "R1",
    line: 1,
    detail: delegate
      ? `renders no <PageShell, nor does its delegate ${delegate}`
      : "renders no <PageShell",
  };
}

function dashboardPages(): string[] {
  return appSurfaceFiles().filter((file) => DASHBOARD_PAGE.test(file));
}

function dashboardFallbacks(): string[] {
  return appSurfaceFiles().filter((file) => DASHBOARD_FALLBACK.test(file));
}

function allOffences(): Offence[] {
  const adoption = [...dashboardPages(), ...dashboardFallbacks()]
    .map((page) => adoptionOffence(page, readSource))
    .filter((offence): offence is Offence => offence !== null);
  const source = appSurfaceFiles().flatMap((file) =>
    findOffences(file, readSource(file)),
  );
  return [...adoption, ...source];
}

const format = (offence: Offence) =>
  `${offence.file}:${offence.line} ${offence.rule} ${offence.detail}`;

describe("page-shell guard (ADR 053)", () => {
  it("finds every routed dashboard page, and not the private _ab-tests one", () => {
    const pages = dashboardPages();
    for (const page of [
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/analytics/page.tsx",
      "src/app/dashboard/billing/page.tsx",
      "src/app/dashboard/content/page.tsx",
      "src/app/dashboard/settings/page.tsx",
      "src/app/dashboard/sites/page.tsx",
      "src/app/dashboard/teams/page.tsx",
    ]) {
      expect(pages).toContain(page);
    }
    expect(pages.some((page) => page.includes("/_ab-tests/"))).toBe(false);
  });

  it("finds the segment's loading and error fallbacks", () => {
    expect(dashboardFallbacks()).toEqual(
      expect.arrayContaining([
        "src/app/dashboard/loading.tsx",
        "src/app/dashboard/error.tsx",
      ]),
    );
  });

  it("names delegates, redirects and standalone pages that exist", () => {
    for (const file of [
      ...Object.keys(DELEGATES),
      ...Object.values(DELEGATES),
      ...REDIRECT_PAGES,
      ...STANDALONE_H1_FILES,
      ...Object.keys(PENDING),
      PAGE_SHELL_FILE,
      PAGE_HEADER_FILE,
    ]) {
      expect(existsSync(path.join(REPO_ROOT, file))).toBe(true);
    }
  });

  // An exemption that outlives the redirect would let a real page ship with
  // no frame: the day teams/page.tsx renders something, it must adopt one.
  it("exempts a redirect page only while it still redirects", () => {
    for (const page of REDIRECT_PAGES) {
      expect(callsRedirect(readSource(page))).toBe(true);
      expect(rendersPageShell(readSource(page))).toBe(false);
    }
  });

  it("finds no offence beyond the pending list", () => {
    const unexpected = allOffences()
      .filter((offence) => !PENDING[offence.file]?.includes(offence.rule))
      .map(format);
    expect(unexpected).toEqual([]);
  });

  it("only ever shrinks: a pending file that passes a listed rule must drop it", () => {
    const offences = allOffences();
    const stale = Object.entries(PENDING).flatMap(([file, rules]) =>
      rules
        .filter(
          (rule) =>
            !offences.some(
              (offence) => offence.file === file && offence.rule === rule,
            ),
        )
        .map(
          (rule) =>
            `${file}: passes ${rule} now — remove it from PENDING in page-shell-guard.test.ts`,
        ),
    );
    expect(stale).toEqual([]);
  });
});

describe("page-shell rules (self-test)", () => {
  const rulesOf = (source: string, file = "src/components/dashboard/X.tsx") =>
    findOffences(file, source).map((offence) => offence.rule);

  describe("R1 adoption", () => {
    const page = "src/app/dashboard/reports/page.tsx";
    const readFrom = (files: Record<string, string>) => (file: string) =>
      files[file] ?? "";

    it("fires on a routed page that renders no PageShell", () => {
      const offence = adoptionOffence(
        page,
        readFrom({
          [page]: "export default () => <div><h2>Reports</h2></div>;",
        }),
      );
      expect(offence?.rule).toBe("R1");
    });

    it("stays quiet on a page that renders one", () => {
      expect(
        adoptionOffence(
          page,
          readFrom({ [page]: '<PageShell title="Reports">x</PageShell>' }),
        ),
      ).toBeNull();
    });

    it("accepts a page whose listed delegate renders one, and only then", () => {
      const billing = "src/app/dashboard/billing/page.tsx";
      const delegate = DELEGATES[billing];
      expect(
        adoptionOffence(
          billing,
          readFrom({
            [billing]: "<BillingDashboard />",
            [delegate]: '<PageShell title="Billing & subscription" />',
          }),
        ),
      ).toBeNull();
      expect(
        adoptionOffence(
          billing,
          readFrom({
            [billing]: "<BillingDashboard />",
            [delegate]: "<div />",
          }),
        )?.rule,
      ).toBe("R1");
    });

    it("is not satisfied by a comment or a string", () => {
      expect(
        adoptionOffence(
          page,
          readFrom({
            [page]: '// <PageShell>\nconst s = "<PageShell";\n<div />',
          }),
        )?.rule,
      ).toBe("R1");
    });

    it("matches the routed pages only", () => {
      expect(DASHBOARD_PAGE.test("src/app/dashboard/page.tsx")).toBe(true);
      expect(DASHBOARD_PAGE.test("src/app/dashboard/sites/[id]/page.tsx")).toBe(
        true,
      );
      expect(DASHBOARD_PAGE.test("src/app/dashboard/_ab-tests/page.tsx")).toBe(
        false,
      );
      expect(DASHBOARD_PAGE.test("src/app/dashboard/layout.tsx")).toBe(false);
    });

    it("matches the segment fallbacks only", () => {
      for (const file of [
        "src/app/dashboard/loading.tsx",
        "src/app/dashboard/error.tsx",
        "src/app/dashboard/sites/[id]/error.tsx",
      ]) {
        expect(DASHBOARD_FALLBACK.test(file)).toBe(true);
      }
      for (const file of [
        "src/app/dashboard/_ab-tests/loading.tsx",
        "src/app/dashboard/global-error.tsx",
        "src/app/dashboard/layout.tsx",
        "src/app/dashboard/page.tsx",
      ]) {
        expect(DASHBOARD_FALLBACK.test(file)).toBe(false);
      }
    });
  });

  describe("R2 one header component", () => {
    it.each([
      '<PageHeader title="Sites" />',
      "<PageHeader\n  title={name}\n/>",
    ])("fires on %s", (source) => {
      expect(rulesOf(source)).toEqual(["R2"]);
    });

    it.each([
      'import { PageHeader, SectionHeader } from "@/components/ui/page-header";',
      "type P = PageHeaderProps;",
      '<SectionHeader title="Your sites" />',
      '{/* <PageHeader title="x" /> */}',
      'const s = "<PageHeader";',
    ])("stays quiet on %s", (source) => {
      expect(rulesOf(source)).toEqual([]);
    });

    it("allows the shell to render it", () => {
      expect(rulesOf("<PageHeader title={title} />", PAGE_SHELL_FILE)).toEqual(
        [],
      );
    });
  });

  describe("R3 one h1", () => {
    it.each([
      // s66b2: was `font-bold`, which R6 now reports as well; the composed
      // case is pinned under R6.
      '<h1 className="text-3xl font-semibold">Settings</h1>',
      "<h1>Content</h1>",
    ])("fires on %s", (source) => {
      expect(rulesOf(source)).toEqual(["R3"]);
    });

    it.each([
      "const INSTALL_EXAMPLE = `<h1>Edited automatically</h1>\n<p>x</p>`;",
      'const tag = "<h1>";',
      "// the page used to render its own <h1>",
      '<h2 className="text-title">Section</h2>',
      "<header data-page-header />",
    ])("stays quiet on %s", (source) => {
      expect(rulesOf(source)).toEqual([]);
    });

    it("allows PageHeader and the standalone pages", () => {
      const source = '<h1 className="text-page-title">{title}</h1>';
      expect(rulesOf(source, PAGE_HEADER_FILE)).toEqual([]);
      for (const file of STANDALONE_H1_FILES) {
        expect(rulesOf(source, file)).toEqual([]);
      }
    });

    it("reports the line", () => {
      const offences = findOffences(
        "src/components/dashboard/X.tsx",
        "\n\n  <h1>Title</h1>",
      );
      expect(offences.map((offence) => offence.line)).toEqual([3]);
    });
  });

  describe("R4 no page container", () => {
    it.each([
      '<div className="container mx-auto px-4 py-8" />',
      '<div className={cn("container", isWide && "max-w-none")} />',
      "<div className={`container ${extra}`} />",
      '<div className={isWide ? "container" : "w-full"} />',
      'const frame = cva("container mx-auto", { variants: {} });',
      '<div className="lg:container" />',
    ])("fires on %s", (source) => {
      expect(rulesOf(source)).toEqual(["R4"]);
    });

    it.each([
      '<div className="rounded-container border" />',
      "const INSTALL_EXAMPLE = `<div data-rcf-content>Opt this container in</div>`;",
      '<Input aria-label="Search container names" />',
      "// Billing nested a container mx-auto px-4",
      "const containerRef = useRef(null);",
      '<div data-container="x" />',
    ])("stays quiet on %s", (source) => {
      expect(rulesOf(source)).toEqual([]);
    });
  });

  describe("R5 flat", () => {
    it.each([
      '<Link className="surface-interactive flex items-center" />',
      '<Card className="hover:shadow-md" />',
      '<div className="group-hover:shadow-lg" />',
      '<div className="group-hover/row:shadow-sm" />',
      '<Card className="transition-shadow" />',
      '<div className="hover:-translate-y-0.5" />',
      '<div className="sm:hover:-translate-y-1" />',
      '<div className="shadow-sm border bg-card" />',
      'const tile = cn("p-4", isOn && "shadow-md");',
      '<div className={`p-6 ${isOn ? "shadow-lg" : ""}`} />',
      '<a className="focus:shadow-md" />',
    ])("fires on %s", (source) => {
      expect(rulesOf(source)).toEqual(["R5"]);
    });

    it.each([
      '<div className="shadow-none" />',
      '<button className="transition-[color,box-shadow] active:translate-y-px" />',
      '<Search className="absolute left-3 top-1/2 -translate-y-1/2" />',
      '<Card className="hover:border-primary/40 hover:bg-surface-2" />',
      "// it used surface-interactive and hover:shadow-md",
      "const toast = `box-shadow: 0 10px 25px rgba(0,0,0,0.1);`;",
    ])("stays quiet on %s", (source) => {
      expect(rulesOf(source)).toEqual([]);
    });

    it("allows a static shadow on what floats, and the skip link's focus: one", () => {
      for (const file of FLOATING_SHADOW_FILES) {
        expect(rulesOf('<div className="shadow-md" />', file)).toEqual([]);
      }
      expect(
        rulesOf('<a className="sr-only focus:shadow-md" />', FOCUS_SHADOW_FILE),
      ).toEqual([]);
      expect(rulesOf('<a className="shadow-md" />', FOCUS_SHADOW_FILE)).toEqual(
        ["R5"],
      );
      expect(
        rulesOf(
          '<div className="hover:shadow-md" />',
          FLOATING_SHADOW_FILES[0],
        ),
      ).toEqual(["R5"]);
    });

    it("reports the line of the token, not of the string", () => {
      const offences = findOffences(
        "src/components/dashboard/X.tsx",
        'const c = cn(\n  "p-4",\n  `border\n   shadow-md`,\n);',
      );
      expect(offences.map((offence) => offence.line)).toEqual([4]);
    });
  });

  describe("R6 weight", () => {
    it.each([
      '<p className="text-3xl font-bold text-foreground" />',
      '<p className="font-extrabold" />',
      '<p className="font-black" />',
      '<p className="md:font-bold" />',
      '<p className={`text-4xl ${big ? "font-bold" : ""}`} />',
    ])("fires on %s", (source) => {
      expect(rulesOf(source)).toEqual(["R6"]);
    });

    it.each([
      '<p className="font-semibold" />',
      '<p className="font-medium" />',
      "{/* font-bold was 700 */}",
      "const WEIGHT = 700;",
    ])("stays quiet on %s", (source) => {
      expect(rulesOf(source)).toEqual([]);
    });

    it("reports both rules on the old Settings title (a stray h1 at 700)", () => {
      expect(
        rulesOf('<h1 className="text-3xl font-bold">Settings</h1>'),
      ).toEqual(["R3", "R6"]);
    });
  });
});
