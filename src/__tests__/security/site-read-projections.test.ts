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
