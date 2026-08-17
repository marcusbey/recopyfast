/**
 * @jest-environment node
 */

/**
 * `server/auth.js` re-implements three rules the HTTP side already owns.
 *
 * That duplication is deliberate — `server/` ships as its own npm package with
 * `server/` as the Docker build context, so importing from `src/` would resolve
 * locally and `MODULE_NOT_FOUND` inside the image (this is a run interdict of
 * the plan, not a preference). What duplication costs is drift, and drift here
 * is a security boundary quietly disagreeing with itself: that is exactly how
 * the socket ended up with the pre-A-2 origin rule while the HTTP side had been
 * fixed.
 *
 * So this is a parity table. Each case is fed to both implementations and their
 * verdicts are compared to each other, not to a literal — a future change to
 * either side shows up here as a red test rather than as an incident.
 */

import { createHmac } from "node:crypto";

import {
  buildSiteToken,
  normalizeDomain as normalizeDomainHttp,
  verifySiteTokenSignature,
} from "@/lib/security/site-auth";
import { normalizePermissions as normalizePermissionsHttp } from "@/lib/auth/editor-access";
import {
  isOriginAllowed,
  normalizeDomain,
  normalizePermissions,
  parseHost,
  verifySiteToken,
} from "../../../server/auth.js";

const SITE_ID = "site-parity";
const API_KEY = "parity-api-key";
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Both sides answer "is this acceptable", but they say no differently: the HTTP
 * helper throws on a malformed signature (`timingSafeEqual` rejects unequal
 * buffer lengths), while the socket helper catches and returns false. Parity is
 * about the verdict, so both refusals are collapsed to `false` here — and the
 * collapsing is one-directional: a throw can never be read as an accept.
 */
function verdict(run: () => boolean): boolean {
  try {
    return run();
  } catch {
    return false;
  }
}

function signedAt(offsetSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000) + offsetSeconds;
  const payload = `${SITE_ID}.${issuedAt}`;
  const signature = createHmac("sha256", API_KEY).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

describe("site token verification parity", () => {
  const cases: Array<[string, string]> = [
    ["a freshly issued token", buildSiteToken(SITE_ID, API_KEY)],
    ["a token signed with another key", buildSiteToken(SITE_ID, "other-key")],
    ["a token issued for another site", buildSiteToken("other-site", API_KEY)],
    ["a token 91 days old", signedAt(-91 * DAY_SECONDS)],
    ["a token 89 days old", signedAt(-89 * DAY_SECONDS)],
    ["a token dated 30 seconds ahead", signedAt(30)],
    ["a token dated an hour ahead", signedAt(3600)],
    ["a two-part token", `${SITE_ID}.123`],
    ["a token with a non-numeric issuedAt", `${SITE_ID}.notanumber.abcdef`],
    ["a token with a short signature", `${SITE_ID}.1700000000.abc`],
    ["an empty token", ""],
  ];

  it.each(cases)("agrees on %s", (_label, token) => {
    const http = verdict(() =>
      verifySiteTokenSignature(SITE_ID, API_KEY, token),
    );
    const socket = verdict(() => verifySiteToken(SITE_ID, API_KEY, token));

    expect(socket).toBe(http);
  });

  it("accepts a valid token on both sides (guard against agreeing on 'no')", () => {
    const token = buildSiteToken(SITE_ID, API_KEY);

    expect(verifySiteTokenSignature(SITE_ID, API_KEY, token)).toBe(true);
    expect(verifySiteToken(SITE_ID, API_KEY, token)).toBe(true);
  });
});

describe("domain normalisation parity", () => {
  const cases = [
    "example.com",
    "EXAMPLE.com",
    "https://example.com",
    "https://example.com/path",
    "example.com:8080",
    "sub.example.com",
  ];

  it.each(cases)("resolves %s to the same host", (domain) => {
    expect(normalizeDomain(domain)).toBe(normalizeDomainHttp(domain));
  });

  it.each(["", "   ", null, undefined])(
    "refuses %s on both sides",
    (domain) => {
      // The HTTP side throws "Invalid domain"; the socket side returns null.
      // Both are refusals, and `isOriginAllowed` turns null into a refusal.
      expect(() => normalizeDomainHttp(domain as string)).toThrow();
      expect(normalizeDomain(domain)).toBeNull();
    },
  );
});

describe("parseHost", () => {
  it("lowercases the host and drops the port and path", () => {
    expect(parseHost("https://EXAMPLE.com:8443/a/b?c=d")).toBe("example.com");
  });

  it("returns null for anything it cannot parse", () => {
    expect(parseHost("example.com")).toBeNull();
    expect(parseHost("")).toBeNull();
    expect(parseHost(undefined)).toBeNull();
  });
});

describe("isOriginAllowed", () => {
  it("admits an exact host match", () => {
    expect(isOriginAllowed("example.com", "https://example.com")).toBe(true);
    expect(
      isOriginAllowed("https://example.com", "https://example.com:443"),
    ).toBe(true);
  });

  it("refuses a subdomain of the registered domain", () => {
    expect(isOriginAllowed("example.com", "https://evil.example.com")).toBe(
      false,
    );
  });

  it("refuses a missing or unparseable origin (A-2)", () => {
    expect(isOriginAllowed("example.com", undefined)).toBe(false);
    expect(isOriginAllowed("example.com", "")).toBe(false);
    expect(isOriginAllowed("example.com", "not-a-url")).toBe(false);
  });

  it("refuses a site with no registered domain, whatever the origin", () => {
    expect(isOriginAllowed(null, "https://example.com")).toBe(false);
    expect(isOriginAllowed(undefined, undefined)).toBe(false);
  });
});

describe("permission hierarchy parity", () => {
  const cases: Array<[string, string[]]> = [
    ["admin", ["admin"]],
    ["publish", ["publish"]],
    ["edit", ["edit"]],
    ["view", ["view"]],
    ["nothing", []],
    ["an unknown grant", ["owner"]],
    ["a duplicated grant", ["edit", "edit", "view"]],
  ];

  it.each(cases)("expands %s identically", (_label, permissions) => {
    expect(normalizePermissions(permissions)).toEqual(
      normalizePermissionsHttp(permissions),
    );
  });

  it("expands admin to the whole ladder (guard against agreeing on '[]')", () => {
    expect(normalizePermissions(["admin"])).toEqual([
      "view",
      "edit",
      "publish",
      "admin",
    ]);
  });
});
