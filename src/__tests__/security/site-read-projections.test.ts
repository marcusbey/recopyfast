import fs from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return sourceFiles(absolutePath);
    }
    return SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ? [absolutePath]
      : [];
  });
}

function relativePath(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function sourceInventory(): Array<{ file: string; source: string }> {
  return [path.join(process.cwd(), "src"), path.join(process.cwd(), "server")]
    .flatMap(sourceFiles)
    .map((file) => ({
      file: relativePath(file),
      source: fs.readFileSync(file, "utf8"),
    }));
}

function directSiteProjections(source: string): string[] {
  const projections: string[] = [];
  const pattern =
    /\.from\(\s*["']sites["']\s*\)[^;]{0,1200}?\.select\(\s*(["'`])([\s\S]*?)\1\s*(?:,[\s\S]*?)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) projections.push(match[2]);
  return projections;
}

function embeddedSiteProjections(source: string): string[] {
  const projections: string[] = [];
  const pattern = /\bsites(?:![A-Za-z0-9_]+)*\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const openingParenthesis = match.index + match[0].lastIndexOf("(");
    let depth = 1;

    for (let index = openingParenthesis + 1; index < source.length; index++) {
      if (source[index] === "(") depth++;
      if (source[index] !== ")") continue;

      depth--;
      if (depth !== 0) continue;

      projections.push(source.slice(openingParenthesis + 1, index).trim());
      break;
    }
  }
  return projections;
}

function projectionIncludesColumn(projection: string, column: string): boolean {
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selectedColumn = new RegExp(
    `^(?:[A-Za-z_][A-Za-z0-9_]*\\s*:\\s*)?${escapedColumn}(?:\\s*::\\s*[A-Za-z_][A-Za-z0-9_]*)?\\s*$`,
  );
  return projection
    .split(",")
    .some((selected) => selectedColumn.test(selected.trim()));
}

describe("sites source-read projections", () => {
  const inventory = sourceInventory();

  it("never uses a default or wildcard projection for a direct sites read", () => {
    const violations = inventory.flatMap(({ file, source }) => {
      const defaultSelect =
        /\.from\(\s*["']sites["']\s*\)[^;]{0,1200}?\.select\(\s*\)/.test(
          source,
        );
      const wildcardSelect =
        /\.from\(\s*["']sites["']\s*\)[^;]{0,1200}?\.select\(\s*["'`]\s*\*/.test(
          source,
        );
      return defaultSelect || wildcardSelect ? [file] : [];
    });

    expect(violations).toEqual([]);
  });

  it("never wildcard-selects sites through an embedded relationship", () => {
    const violations = inventory.flatMap(({ file, source }) =>
      /\bsites(?:![A-Za-z0-9_]+)?\s*\(\s*\*/.test(source) ? [file] : [],
    );

    expect(violations).toEqual([]);
  });

  it("keeps api_key reads confined to the audited service-role call sites", () => {
    const actual = inventory
      .flatMap(({ file, source }) =>
        directSiteProjections(source)
          .filter((projection) =>
            projection
              .split(",")
              .map((column) => column.trim())
              .includes("api_key"),
          )
          .map(
            (projection) =>
              `${file}: ${projection.replace(/\s+/g, " ").trim()}`,
          ),
      )
      .sort();

    const embeddedViolations = inventory.flatMap(({ file, source }) =>
      embeddedSiteProjections(source)
        .filter((projection) => projectionIncludesColumn(projection, "api_key"))
        .map(
          (projection) => `${file}: ${projection.replace(/\s+/g, " ").trim()}`,
        ),
    );

    expect(actual).toEqual(
      [
        "server/index.js: id, domain, api_key",
        "src/app/api/sites/[siteId]/regenerate-snippet/route.ts: id, api_key",
        "src/app/api/sites/register/route.ts: id, domain, name, created_at, api_key",
        "src/app/api/sites/route.ts: id, domain, name, created_at, updated_at, api_key, status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at",
        "src/lib/security/site-auth.ts: id, domain, api_key",
        "src/lib/security/site-auth.ts: id, domain, api_key",
      ].sort(),
    );
    expect(embeddedViolations).toEqual([]);
  });

  it.each([
    ["plain", "site_permissions?select=id,sites(id,domain,api_key)"],
    ["inner join", "site_permissions?select=id,sites!inner(id, api_key)"],
    ["aliased inner join", "site:sites!inner(id, domain, api_key, status)"],
    ["aliased column", "sites(id, secret:api_key)"],
    ["cast column", "sites(id, api_key::text)"],
    [
      "foreign-key inner join",
      "sites!permission_site_id_fkey!inner(id, api_key)",
    ],
    [
      "nested relationship before the secret",
      "sites!inner(id, site_permissions(id), api_key)",
    ],
    [
      "nested sites relationship",
      "sites(id, site_permissions(sites(api_key)))",
    ],
  ])("detects api_key in a synthetic %s sites embed", (_label, source) => {
    expect(
      embeddedSiteProjections(source).filter((projection) =>
        projectionIncludesColumn(projection, "api_key"),
      ),
    ).toHaveLength(1);
  });

  it("retains the service signing projections that validate HTTP and websocket tokens", () => {
    const siteAuth = fs.readFileSync(
      path.join(process.cwd(), "src/lib/security/site-auth.ts"),
      "utf8",
    );
    const websocketServer = fs.readFileSync(
      path.join(process.cwd(), "server/index.js"),
      "utf8",
    );

    expect(
      directSiteProjections(siteAuth).filter((projection) =>
        projection.includes("api_key"),
      ),
    ).toHaveLength(2);
    expect(
      directSiteProjections(websocketServer).filter((projection) =>
        projection.includes("api_key"),
      ),
    ).toEqual(["id, domain, api_key"]);
  });
});
