import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ADR 059 is a document policy boundary, not merely a route-name boundary.
 *
 * A Next Link from the static marketing document to an app route performs a
 * client transition, so the browser never receives the destination's nonce
 * response header. These are the reusable/static surfaces that can initiate
 * that transition. App-internal links stay Next Links and keep their stateful
 * navigation; only a crossing into /login, /signup, /edit or /dashboard must
 * be a normal anchor and therefore a new document request.
 */
const MARKETING_BOUNDARY_FILES = [
  "src/app/auth/error/page.tsx",
  "src/app/blog/page.tsx",
  "src/app/compare/page.tsx",
  "src/app/demo/page.tsx",
  "src/app/docs/install/page.tsx",
  "src/app/not-found.tsx",
  "src/app/try/page.tsx",
  "src/components/auth/UserMenu.tsx",
  "src/components/compare/ComparisonPage.tsx",
  "src/components/sections/FinalCTA.tsx",
  "src/components/sections/FoundingOfferCard.tsx",
  "src/components/sections/Hero.tsx",
  "src/components/sections/Pricing.tsx",
] as const;

const APP_ROUTE_HREF =
  /href\s*=\s*(?:"\/(?:dashboard|edit|login|settings|signup)(?:[^"\s]*)"|{\s*`\/(?:dashboard|edit|login|settings|signup)[^`]*`\s*})/;

const ATTRIBUTED_BOUNDARIES = [
  [
    "src/app/compare/page.tsx",
    'href="/signup?utm_source=comparison&utm_medium=page&utm_campaign=compare_index"',
  ],
  [
    "src/app/try/page.tsx",
    'href="/signup?utm_source=try&utm_medium=page&utm_campaign=try_on_any_site"',
  ],
  [
    "src/components/compare/ComparisonPage.tsx",
    "href={`/signup?utm_source=comparison&utm_medium=page&utm_campaign=compare_${comparison.slug}`}",
  ],
] as const;

function nextLinkOpenings(source: string): string[] {
  return source.match(/<Link\b[\s\S]*?>/g) ?? [];
}

describe("static-to-app CSP document boundaries", () => {
  it.each(MARKETING_BOUNDARY_FILES)(
    "%s uses document navigation for every app destination",
    (file) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      const violations = nextLinkOpenings(source).filter((opening) =>
        APP_ROUTE_HREF.test(opening),
      );

      expect(violations).toEqual([]);
    },
  );

  it("the shared marketing header sends auth entry to nonce documents", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/layout/Header.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/<AuthModal\b/);
    expect(source).toMatch(/<a\b[^>]*href="\/login"/);
    expect(source).toMatch(/<a\b[^>]*href="\/signup"/);
  });

  it("the marketing user menu document-navigates through the /settings redirect alias", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/auth/UserMenu.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<a\b[^>]*href="\/settings"/);
    expect(
      nextLinkOpenings(source).filter((opening) =>
        /href\s*=\s*"\/settings"/.test(opening),
      ),
    ).toEqual([]);
  });

  it.each(ATTRIBUTED_BOUNDARIES)(
    "%s preserves its complete attributed destination",
    (file, href) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain(href);
    },
  );
});
