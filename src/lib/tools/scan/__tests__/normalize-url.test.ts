/**
 * @jest-environment node
 */

/**
 * s96 — a scanned address is normalised before anything else reads it: the
 * cache key, the per-host limiter, the denylist, the fetcher and the stored
 * row all see the same string.
 *
 * The WHATWG behaviours relied on here (decimal/hex/octal IPv4 rewritten to
 * dotted quads, IDN to punycode, zone ids refused) were verified on Node 24.14
 * on 2026-10-11; a runtime that changes them fails these rows.
 */

import { scanCacheKey } from "../cache-key";
import { isDenylistedHost, parseDenylist } from "../denylist";
import { normalizeScanUrl } from "../normalize-url";

function href(raw: string): string | null {
  const result = normalizeScanUrl(raw);
  return result.ok ? result.value.href : null;
}

function reason(raw: unknown): string | null {
  const result = normalizeScanUrl(raw);
  return result.ok ? null : result.reason;
}

describe("normalizeScanUrl", () => {
  it("adds https:// when no scheme was typed", () => {
    expect(href("example.com")).toBe("https://example.com/");
    expect(href("  example.com/pricing  ")).toBe("https://example.com/pricing");
  });

  it("lower-cases the host, drops the default port, the query and the fragment", () => {
    const result = normalizeScanUrl("HTTP://Example.COM:80/a?b=1#c");

    expect(result).toEqual({
      ok: true,
      value: {
        href: "http://example.com/a",
        hostname: "example.com",
        origin: "http://example.com",
      },
    });
    expect(href("https://example.com:443/x?token=secret")).toBe(
      "https://example.com/x",
    );
  });

  it("refuses user info, which would otherwise travel in every fetch and row", () => {
    expect(reason("https://user:pass@example.com/")).toBe("invalid_url");
    expect(reason("https://user@example.com/")).toBe("invalid_url");
  });

  it("refuses any port but the scheme's default", () => {
    expect(reason("https://example.com:8080/")).toBe("blocked_port");
    expect(reason("example.com:8443")).toBe("blocked_port");
    expect(reason("http://example.com:443/")).toBe("blocked_port");
  });

  it("lets a caller widen the port rule (the fetcher's test policy does)", () => {
    const result = normalizeScanUrl("http://fixture.test:4123/", {
      isAllowedPort: (_protocol, port) => port === "4123",
    });

    expect(result.ok && result.value.href).toBe("http://fixture.test:4123/");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/",
    "data:text/html,<p>x</p>",
    "blob:https://example.com/uuid",
    "mailto:someone@example.com",
  ])("refuses the non-web scheme in %s", (raw) => {
    expect(reason(raw)).toBe("invalid_url");
  });

  it("strips a trailing dot, so `example.com.` is one host with `example.com`", () => {
    const result = normalizeScanUrl("https://Example.com./a");

    expect(result.ok && result.value).toEqual({
      href: "https://example.com/a",
      hostname: "example.com",
      origin: "https://example.com",
    });
  });

  it("encodes an internationalised host as punycode", () => {
    expect(href("https://bücher.example/")).toBe(
      "https://xn--bcher-kva.example/",
    );
  });

  it("refuses an IPv6 zone id (WHATWG throws on it)", () => {
    expect(reason("http://[fe80::1%25eth0]/")).toBe("invalid_url");
  });

  it.each(["http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/"])(
    "rewrites the alternate IPv4 spelling %s to 127.0.0.1 (the fetcher refuses it)",
    (raw) => {
      const result = normalizeScanUrl(raw);

      expect(result.ok && result.value.hostname).toBe("127.0.0.1");
    },
  );

  /**
   * s96 review round 2, minor 2. WHATWG accepts host labels like `-a`, `a-`
   * and `a!b`; the Public Suffix List lookup then found no registrable domain
   * and the per-target cap fell back to the whole host — one bucket per
   * invented subdomain under wildcard DNS. Every label must be LDH (letters,
   * digits, inner hyphens, at most 63), checked after IDN became punycode.
   */
  it.each([
    "https://-a.victim.com/",
    "https://a-.victim.com/",
    "https://a!b.victim.com/",
    "https://a_b.victim.com/",
    "https://a..victim.com/",
    `https://${"a".repeat(64)}.victim.com/`,
  ])("refuses the non-LDH host label in %s", (raw) => {
    expect(reason(raw)).toBe("invalid_url");
  });

  it.each([
    ["https://a-b.victim.com/", "https://a-b.victim.com/"],
    ["https://123.victim.com/", "https://123.victim.com/"],
    ["https://bücher.example/", "https://xn--bcher-kva.example/"],
    [
      `https://${"a".repeat(63)}.victim.com/`,
      `https://${"a".repeat(63)}.victim.com/`,
    ],
    ["http://93.184.216.34/", "http://93.184.216.34/"],
    ["http://[2606:4700:4700::1111]/", "http://[2606:4700:4700::1111]/"],
  ])("keeps the LDH host (or IP literal) in %s", (raw, expected) => {
    expect(href(raw)).toBe(expected);
  });

  it("refuses control characters and anything over 2,048 characters", () => {
    expect(reason("https://exa\u0000mple.com/")).toBe("invalid_url");
    expect(reason("https://example.com/\u0007")).toBe("invalid_url");
    expect(reason(`https://example.com/${"a".repeat(2_029)}`)).toBe(
      "invalid_url",
    );
    expect(href(`https://example.com/${"a".repeat(2_028)}`)).toHaveLength(
      2_048,
    );
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    "   ",
    "https://",
    "https://ex ample.com/",
  ])("refuses %p", (raw) => {
    expect(reason(raw)).toBe("invalid_url");
  });
});

describe("scanCacheKey", () => {
  it("is a stable SHA-256 hex digest", () => {
    const key = scanCacheKey("website-spell-checker", "https://example.com/");

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(scanCacheKey("website-spell-checker", "https://example.com/")).toBe(
      key,
    );
  });

  it("is scoped to the tool and to the exact normalised address", () => {
    const key = scanCacheKey("website-spell-checker", "https://example.com/");

    expect(scanCacheKey("csp-checker", "https://example.com/")).not.toBe(key);
    expect(
      scanCacheKey("website-spell-checker", "https://example.com/a"),
    ).not.toBe(key);
  });
});

describe("the operator denylist", () => {
  const list = parseDenylist(
    " Example.com , *.blocked.test,  , .other.test., bücher.example ",
  );

  it("reads comma-separated hosts, lower-cased, without wildcards or trailing dots", () => {
    expect(list).toEqual([
      "example.com",
      "blocked.test",
      "other.test",
      "xn--bcher-kva.example",
    ]);
    expect(parseDenylist(undefined)).toEqual([]);
    expect(parseDenylist("not a host, also/bad")).toEqual([]);
  });

  it("matches the host and its subdomains", () => {
    expect(isDenylistedHost("example.com", list)).toBe(true);
    expect(isDenylistedHost("www.example.com", list)).toBe(true);
    expect(isDenylistedHost("a.b.blocked.test", list)).toBe(true);
    expect(isDenylistedHost("xn--bcher-kva.example", list)).toBe(true);
  });

  it("does not match a look-alike suffix", () => {
    expect(isDenylistedHost("evilexample.com", list)).toBe(false);
    expect(isDenylistedHost("example.com.evil.test", list)).toBe(false);
    expect(isDenylistedHost("notblocked.test", list)).toBe(false);
  });
});
