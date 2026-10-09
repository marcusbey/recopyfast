/**
 * @jest-environment node
 */

/*
 * s76 — s69 L12: an origin belongs to a site only on the site's exact host.
 *
 * `originBelongsToSite` decides where a device grant may be minted
 * (submit-code, handoff/redeem) and, since s76, where an edit-link code may be
 * spent. It used to accept any subdomain of the registered domain, while the
 * widget's content and publish requests are pinned to the exact registered
 * hostname (`authorizeSiteRequest`, site-auth.ts) — so the subdomain branch let
 * nobody edit `www.` on an `example.com` site, and did let a grant be minted
 * for, and bound to, whatever answers at `evil.example.com` (user content on a
 * shared parent, a dangling CNAME): a credential issued under our name for an
 * origin that is not the customer's.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { normalizeDomain, parseOrigin } from "@/lib/security/site-auth";
import { originBelongsToSite } from "../editor-request";

jest.mock("@/lib/supabase/service");

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

function siteWithDomain(
  domain: string | null,
  error: { message: string } | null = null,
) {
  jest.mocked(createServiceRoleClient).mockReturnValue({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve(
            error
              ? { data: null, error }
              : { data: domain === null ? null : { domain }, error: null },
          ),
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>);
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
  jest.restoreAllMocks();
});

describe("the registered host itself belongs to the site", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["example.com", "https://EXAMPLE.com"],
    ["example.com", "http://example.com"],
    ["example.com", "https://example.com:8443"],
    ["https://Example.com/shop", "https://example.com"],
    ["www.example.com", "https://www.example.com"],
  ])("registered %s, origin %s", async (domain, origin) => {
    siteWithDomain(domain);

    await expect(originBelongsToSite("site-1", origin)).resolves.toBe(true);
  });
});

describe("any other host does not", () => {
  it.each([
    // The L12 cases: a subdomain of the registered domain.
    ["example.com", "https://evil.example.com"],
    ["example.com", "https://www.example.com"],
    ["example.com", "https://a.b.example.com"],
    // The parent of a narrower registration.
    ["www.example.com", "https://example.com"],
    // Look-alikes.
    ["example.com", "https://example.com.evil.test"],
    ["example.com", "https://notexample.com"],
  ])("registered %s, origin %s", async (domain, origin) => {
    siteWithDomain(domain);

    await expect(originBelongsToSite("site-1", origin)).resolves.toBe(false);
  });

  it("an unparseable origin", async () => {
    siteWithDomain("example.com");

    await expect(originBelongsToSite("site-1", "not a url")).resolves.toBe(
      false,
    );
  });

  it("a site that does not exist or has no domain", async () => {
    siteWithDomain(null);
    await expect(
      originBelongsToSite("site-1", "https://example.com"),
    ).resolves.toBe(false);

    siteWithDomain("");
    await expect(
      originBelongsToSite("site-1", "https://example.com"),
    ).resolves.toBe(false);
  });
});

describe("a site that cannot be read gets no verdict", () => {
  it("answers null, never false, so callers answer 503 rather than 403", async () => {
    // s76 review minor 2: `false` here became "this site isn't served from
    // its registered domain" — a 403 on which the widget forgets an edit-link
    // code — for what was a database outage.
    jest.spyOn(console, "error").mockImplementation(() => {});
    siteWithDomain("example.com", { message: "connection refused" });

    await expect(
      originBelongsToSite("site-1", "https://example.com"),
    ).resolves.toBeNull();
  });
});

describe("localhost is a development convenience only", () => {
  it("is accepted outside production", async () => {
    env.NODE_ENV = "test";
    siteWithDomain("example.com");

    await expect(
      originBelongsToSite("site-1", "http://localhost:3000"),
    ).resolves.toBe(true);
  });

  it("is refused in production", async () => {
    env.NODE_ENV = "production";
    siteWithDomain("example.com");

    await expect(
      originBelongsToSite("site-1", "http://localhost:3000"),
    ).resolves.toBe(false);
    await expect(
      originBelongsToSite("site-1", "http://127.0.0.1:3000"),
    ).resolves.toBe(false);
  });
});

describe("one rule with the content routes", () => {
  // `authorizeSiteRequest` refuses a widget request unless
  // `parseOrigin(origin) === normalizeDomain(site.domain)`. A grant minted
  // where that is false could never save anything; one minted where it is true
  // must be mintable. Production, so the localhost convenience is out of it.
  const domains = [
    "example.com",
    "https://Example.com/shop",
    "www.example.com",
    "example.com:8443",
  ];
  const origins = [
    "https://example.com",
    "http://example.com:8443",
    "https://www.example.com",
    "https://evil.example.com",
    "https://example.com.evil.test",
    "https://notexample.com",
  ];

  it.each(domains)(
    "agrees with authorizeSiteRequest for %s",
    async (domain) => {
      env.NODE_ENV = "production";
      siteWithDomain(domain);

      for (const origin of origins) {
        const contentRoutesAccept =
          parseOrigin(origin) === normalizeDomain(domain);
        await expect(originBelongsToSite("site-1", origin)).resolves.toBe(
          contentRoutesAccept,
        );
      }
    },
  );
});
