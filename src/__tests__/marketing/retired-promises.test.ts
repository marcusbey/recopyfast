/**
 * @jest-environment node
 */

/**
 * s50 — five promises the product never kept, and that must not come back.
 *
 * Each one reached a visitor through a different door: the money-back
 * guarantee was a hardcoded Pricing bullet with no refund clause in /terms;
 * "Priority support", the "onboarding call" and "all future Pro features" were
 * plan rows in `plans`, rendered on the pricing cards and projected onto the
 * Stripe products; and every contact address sat on `recopyfast.com`, a domain
 * nobody registered (NXDOMAIN), so whoever registers it receives the mail.
 *
 * The guard reads two things, because the copy lives in two places:
 *
 * - The user-visible strings of the public source, read as AST literals. The
 *   tombstones this story leaves name the retired claims on purpose, and so
 *   does HowItWorks' history of the `cdn.recopyfast.com` host, so comments
 *   must never count.
 * - The plans catalogue as the last migration leaves it. The seeds that wrote
 *   the old copy are applied and can never be edited, so what matters is that
 *   nothing after the s50 migration writes those phrases again.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import * as ts from "typescript";

const RETIRED = [
  "recopyfast.com",
  "money-back",
  "priority support",
  "onboarding call",
  "future pro features",
];

const ROOT = process.cwd();

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

/** Every piece of text a file can put on a page, and nothing from its comments. */
function copyStrings(text: string, fileName: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    SCRIPT_KINDS[extname(fileName)] ?? ts.ScriptKind.TS,
  );
  const strings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return strings;
}

// A superset of the public pages: simpler to state and to check than a
// per-route import graph. `public/` is out on purpose — `public/demo-site` is a
// fictional customer's page, and its "Priority support" is theirs, not ours.
const SCAN_ROOTS = ["src/app", "src/components", "src/lib/compare"];
const EXCLUDED_DIRS = [join(ROOT, "src/app/api")];

function isScannedFile(name: string): boolean {
  return /\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name);
}

function walk(dir: string): string[] {
  if (EXCLUDED_DIRS.includes(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : walk(path);
    }
    return isScannedFile(entry.name) ? [path] : [];
  });
}

const publicSource = SCAN_ROOTS.flatMap((root) => walk(join(ROOT, root))).map(
  (path) => ({
    file: relative(ROOT, path),
    strings: copyStrings(readFileSync(path, "utf8"), path),
  }),
);

function filesSaying(phrase: string): string[] {
  const needle = phrase.toLowerCase();
  return publicSource
    .filter(({ strings }) =>
      strings.some((text) => text.toLowerCase().includes(needle)),
    )
    .map(({ file }) => file)
    .sort();
}

describe("copy-string scanner", () => {
  it("reads string literals, template text, JSX text and attributes, never comments", () => {
    const sample = [
      'const literal = "retired in a string literal";',
      "const plain = `retired in a plain template`;",
      "const spliced = `retired in a head ${literal} retired in a middle ${plain} retired in a tail`;",
      "// retired in a line comment",
      "/* retired in a block comment */",
      'export const Card = () => <p title="retired in an attribute">retired in JSX text</p>;',
    ].join("\n");

    const strings = copyStrings(sample, "sample.tsx");

    expect(strings).toEqual(
      expect.arrayContaining([
        "retired in a string literal",
        "retired in a plain template",
        "retired in a head ",
        " retired in a middle ",
        " retired in a tail",
        "retired in an attribute",
        "retired in JSX text",
      ]),
    );
    expect(strings.join("\n")).not.toContain("comment");
  });

  it("reaches the real public source", () => {
    expect(publicSource.length).toBeGreaterThan(100);

    const footer = publicSource.find(
      ({ file }) => file === join("src", "components", "layout", "Footer.tsx"),
    );
    expect(footer?.strings).toContain("Privacy Policy");
  });
});

describe("public page source", () => {
  it.each(RETIRED)("no public page says %s", (phrase) => {
    expect(filesSaying(phrase)).toEqual([]);
  });
});

describe("plans catalogue, as the last migration leaves it", () => {
  const MIGRATIONS = join(ROOT, "supabase/migrations");
  const SEEDS = [
    "20260802000000_plans_catalog.sql",
    "20260924065000_agency_plan_and_founding_capacity.sql",
  ];
  const COPY_TRUTH = "20260928130000_catalogue_copy_truth.sql";

  /** Statements only: a header's prose must not satisfy or trip anything. */
  const statements = (file: string) =>
    readFileSync(join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "");

  const saysRetired = (text: string) =>
    RETIRED.some((phrase) => text.toLowerCase().includes(phrase));

  /** Each seeded VALUES tuple, from its quoted id to its closing paren. */
  function seededRows(sql: string): { id: string; row: string }[] {
    return [...sql.matchAll(/\(\s*'(\w+)', '(?:subscription|one_time)'/g)].map(
      (match) => {
        const start = match.index as number;
        return {
          id: match[1],
          row: sql.slice(start, sql.indexOf("\n  )", start)),
        };
      },
    );
  }

  it("the retired phrases survive only in the applied seeds", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((file) => saysRetired(statements(file)))).toEqual(
      SEEDS,
    );

    const carriers = SEEDS.flatMap((file) => {
      const sql = statements(file);
      const rows = seededRows(sql).filter(({ row }) => saysRetired(row));
      // Nothing outside those rows says it either.
      const rest = rows.reduce((text, { row }) => text.replace(row, ""), sql);
      expect(saysRetired(rest)).toBe(false);
      return rows.map(({ id }) => id);
    });
    expect(carriers.sort()).toEqual(["agency", "lifetime_pro", "pro"]);
  });

  it("20260928130000 rewrites the features of every row that carries one", () => {
    const sql = statements(COPY_TRUTH);

    for (const id of ["pro", "lifetime_pro", "agency"]) {
      const update = [
        ...sql.matchAll(
          /UPDATE public\.plans\s+SET([\s\S]*?)WHERE id = '(\w+)';/g,
        ),
      ].find((match) => match[2] === id);
      expect(update).toBeDefined();

      const features = (update as RegExpMatchArray)[1].match(
        /\bfeatures = '([^']*)'::jsonb/,
      );
      expect(features).not.toBeNull();
      expect(saysRetired((features as RegExpMatchArray)[1])).toBe(false);
    }

    // Last writer: it has to sort after both seeds to overwrite them.
    expect([...SEEDS, COPY_TRUTH].sort().at(-1)).toBe(COPY_TRUTH);
  });
});
