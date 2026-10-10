/**
 * s65a — one canonical URL per snapshot.
 *
 * Vercel's CDN keys a function response on the full query string, so every
 * spelling of the same (site, page, language, variant) that reached the origin
 * would be its own cache entry and its own database read. These tests pin the
 * single accepted spelling and enumerate the variants that must be refused
 * before any work is done.
 *
 * Parser-level only for the percent-encoding spellings under "query shape"
 * (a literal slash, lowercase hex, `%20` for `+`, `%65n` for `en`, a trailing
 * `&`): the parser refuses them on the raw string, as here, but a real Next
 * server re-serializes the query before the route handler runs, so in
 * production they arrive canonical and are served as the canonical key (owner
 * decision 2026-10-07, ADR 046; asserted on `next start` by
 * e2e/published-snapshot-ssr.spec.ts). Parameter order, extra, repeated and
 * missing parameters, and every value check, still refuse in production.
 */
import {
  canonicalSnapshotQuery,
  parsePublishedSnapshotKey,
} from "@/lib/content/published-snapshot-key";

const SITE_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";

function search(query: string): string {
  return `?${query}`;
}

describe("canonicalSnapshotQuery", () => {
  it("is the URLSearchParams serialization in page, language, variant order", () => {
    expect(canonicalSnapshotQuery("/pricing", "en", "default")).toBe(
      "page=%2Fpricing&language=en&variant=default",
    );
  });
});

describe("parsePublishedSnapshotKey", () => {
  it("accepts the canonical form and returns the key", () => {
    expect(
      parsePublishedSnapshotKey(
        SITE_ID,
        search("page=%2Fpricing&language=en&variant=default"),
      ),
    ).toEqual({
      ok: true,
      key: {
        siteId: SITE_ID,
        pagePath: "/pricing",
        language: "en",
        variant: "default",
      },
    });
  });

  it.each([
    ["the root page", "/", "en", "default"],
    ["a translate language tag", "/", "pt-BR", "default"],
    ["a three-letter language tag with a script", "/a", "zho-Hant", "default"],
    ["a free-form v1 variant name", "/a", "en", "Spring Promo"],
    ["a literal percent page (widget output for /%25)", "/%", "en", "default"],
    [
      "an encoded-space page (widget output for /%2520)",
      "/%20",
      "en",
      "default",
    ],
    [
      "/index.html (widget output for /index.html/)",
      "/index.html",
      "en",
      "default",
    ],
    ["non-ASCII values", "/café", "fr", "défaut"],
    ["a 64-character variant", "/", "en", "v".repeat(64)],
    // No length cap (s65a fix round 4): v1 POST/PUT and bulk import store
    // unbounded TEXT, so any length a writer stored must stay reachable.
    ["a 65-character variant", "/", "en", "v".repeat(65)],
    ["a 500-character variant", "/", "en", "v".repeat(500)],
  ])("accepts %s", (_label, page, language, variant) => {
    const result = parsePublishedSnapshotKey(
      SITE_ID,
      search(canonicalSnapshotQuery(page, language, variant)),
    );

    expect(result).toEqual({
      ok: true,
      key: { siteId: SITE_ID, pagePath: page, language, variant },
    });
  });

  describe("site id", () => {
    it.each([
      ["uppercase", SITE_ID.toUpperCase()],
      ["not a UUID", "site-1"],
      ["braced", `{${SITE_ID}}`],
      ["empty", ""],
      ["with a trailing newline", `${SITE_ID}\n`],
    ])("rejects a site id that is %s", (_label, siteId) => {
      expect(
        parsePublishedSnapshotKey(
          siteId,
          search("page=%2F&language=en&variant=default"),
        ),
      ).toEqual({ ok: false, reason: "invalid_site_id" });
    });
  });

  describe("query shape", () => {
    it.each([
      ["no query", ""],
      ["a bare question mark", "?"],
      ["a missing variant", search("page=%2F&language=en")],
      ["a missing page", search("language=en&variant=default")],
      [
        "an extra parameter",
        search("page=%2F&language=en&variant=default&v=1"),
      ],
      [
        "a cache-busting parameter first",
        search("cb=1&page=%2F&language=en&variant=default"),
      ],
      [
        "a duplicate parameter",
        search("page=%2F&language=en&language=en&variant=default"),
      ],
      ["reordered parameters", search("language=en&page=%2F&variant=default")],
      [
        "a literal slash instead of %2F",
        search("page=/&language=en&variant=default"),
      ],
      [
        "a literal slash in a deeper page",
        search("page=/pricing&language=en&variant=default"),
      ],
      [
        "lowercase percent hex",
        search("page=%2fpricing&language=en&variant=default"),
      ],
      [
        "%20 instead of + for a space",
        search("page=%2F&language=en&variant=Spring%20Promo"),
      ],
      [
        "a needlessly encoded letter",
        search("page=%2F&language=%65n&variant=default"),
      ],
      ["a trailing ampersand", search("page=%2F&language=en&variant=default&")],
      ["a parameter without a value", search("page=%2F&language=en&variant")],
    ])("rejects %s", (_label, query) => {
      expect(parsePublishedSnapshotKey(SITE_ID, query)).toEqual({
        ok: false,
        reason: "non_canonical_query",
      });
    });
  });

  describe("page", () => {
    it.each([
      ["relative", "pricing"],
      ["empty", ""],
      ["a trailing slash", "/pricing/"],
      ["a doubled trailing slash", "/pricing//"],
      ["a control character", "/pri\ncing"],
      ["a query delimiter", "/pricing?x=1"],
      ["a fragment delimiter", "/pricing#top"],
      ["over 1,024 characters", `/${"a".repeat(1024)}`],
    ])("rejects a page that is %s", (_label, page) => {
      expect(
        parsePublishedSnapshotKey(
          SITE_ID,
          search(canonicalSnapshotQuery(page, "en", "default")),
        ),
      ).toEqual({ ok: false, reason: "invalid_page" });
    });
  });

  describe.each([
    ["language", "invalid_language"],
    ["variant", "invalid_variant"],
  ] as const)("%s", (field, reason) => {
    it.each([
      ["empty", ""],
      ["a newline", "en\n"],
      ["a carriage return", "en\r"],
      ["a NUL", "en\u0000"],
      ["DEL", "en\u007f"],
      ["a C1 control", "en\u0085"],
    ])(`rejects a ${field} that is %s`, (_label, value) => {
      const language = field === "language" ? value : "en";
      const variant = field === "variant" ? value : "default";

      expect(
        parsePublishedSnapshotKey(
          SITE_ID,
          search(canonicalSnapshotQuery("/", language, variant)),
        ),
      ).toEqual({ ok: false, reason });
    });
  });
});
