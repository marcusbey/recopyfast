/**
 * @jest-environment node
 */

/*
 * s76 (ADR 055) — the code the owner's "Edit website" link carries.
 *
 * Not the edit session's token: a signed envelope naming one session and one
 * site, dead after 60 seconds, travelling in the URL fragment. These pin its
 * format; spending it (once) is validate-edit-link.test.ts.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  EDIT_LINK_TTL_MS,
  buildEditUrl,
  isEditLinkCode,
  mintEditLinkCode,
  readEditLinkCode,
} from "../edit-link";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  resetSigningKeyCache,
} from "../editor-crypto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  resetSigningKeyCache();
});

describe("the code", () => {
  it("names its session and site, and dies 60 seconds after it is minted", () => {
    const before = Date.now();
    const code = mintEditLinkCode({ sessionId: SESSION_ID, siteId: SITE_ID });
    const claim = readEditLinkCode(code);

    expect(claim).toMatchObject({ sessionId: SESSION_ID, siteId: SITE_ID });
    expect(claim!.expiresAt.getTime()).toBeGreaterThan(before);
    expect(claim!.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + EDIT_LINK_TTL_MS,
    );
    expect(EDIT_LINK_TTL_MS).toBe(60_000);
  });

  it("is URL-safe as it stands, so the fragment needs no encoding", () => {
    const code = mintEditLinkCode({ sessionId: SESSION_ID, siteId: SITE_ID });

    expect(code).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(isEditLinkCode(code)).toBe(true);
  });

  it("reads an expired code (the spender, not the reader, refuses it)", () => {
    const code = encodeSignedToken("rcfl1", CRYPTO_DOMAIN.editLink, {
      e: SESSION_ID,
      s: SITE_ID,
      x: Math.floor((Date.now() - 1000) / 1000),
    });

    expect(readEditLinkCode(code)?.expiresAt.getTime()).toBeLessThan(
      Date.now(),
    );
  });

  it("refuses a code whose payload was edited", () => {
    const code = mintEditLinkCode({ sessionId: SESSION_ID, siteId: SITE_ID });
    const [prefix, , signature] = code.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        e: SESSION_ID,
        s: "33333333-3333-4333-8333-333333333333",
        x: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    expect(readEditLinkCode(`${prefix}.${forged}.${signature}`)).toBeNull();
  });

  it("refuses an envelope signed for another purpose", () => {
    // Domain separation: a device grant's signature over the same bytes, under
    // the same prefix, is not an edit-link signature.
    const crossPurpose = encodeSignedToken("rcfl1", CRYPTO_DOMAIN.grant, {
      e: SESSION_ID,
      s: SITE_ID,
      x: Math.floor(Date.now() / 1000) + 60,
    });

    expect(readEditLinkCode(crossPurpose)).toBeNull();
  });

  it.each([
    ["an empty string", ""],
    ["a raw edit-session token", "b3JOZXZlckd1ZXNzYWJsZVRva2VuVmFsdWVGb3JB"],
    ["three dots", "a.b.c"],
    ["a grant's prefix", "rcfg1.e30.sig"],
  ])("refuses %s", (_, value) => {
    expect(readEditLinkCode(value)).toBeNull();
  });

  it("tells a code from a raw session token by its prefix alone", () => {
    expect(isEditLinkCode("rcfl1.payload.signature")).toBe(true);
    expect(isEditLinkCode("b3JOZXZlckd1ZXNzYWJsZVRva2Vu")).toBe(false);
    expect(isEditLinkCode("")).toBe(false);
  });

  it("refuses a well-signed envelope with a missing field", () => {
    const incomplete = encodeSignedToken("rcfl1", CRYPTO_DOMAIN.editLink, {
      e: SESSION_ID,
      x: Math.floor(Date.now() / 1000) + 60,
    });

    expect(readEditLinkCode(incomplete)).toBeNull();
  });

  it.each([
    ["no expiry", { e: SESSION_ID, s: SITE_ID }],
    // A string that `new Date(x * 1000)` would coerce into a valid far-future
    // date: only a JSON number is an expiry (review minor 1).
    [
      "an expiry that is a string",
      { e: SESSION_ID, s: SITE_ID, x: "4102444800" },
    ],
    ["an expiry that is null", { e: SESSION_ID, s: SITE_ID, x: null }],
  ])("refuses a well-signed envelope with %s", (_, payload) => {
    const code = encodeSignedToken("rcfl1", CRYPTO_DOMAIN.editLink, payload);

    expect(readEditLinkCode(code)).toBeNull();
  });
});

describe("the link", () => {
  const CODE = "rcfl1.payload.signature";

  it.each([
    ["example.com", "https://example.com/#rcf_edit=rcfl1.payload.signature"],
    [
      "https://example.com",
      "https://example.com/#rcf_edit=rcfl1.payload.signature",
    ],
    [
      "https://Example.com/shop?x=1",
      "https://example.com/#rcf_edit=rcfl1.payload.signature",
    ],
    [
      "example.com:8443",
      "https://example.com:8443/#rcf_edit=rcfl1.payload.signature",
    ],
    [
      "http://localhost:3000",
      "http://localhost:3000/#rcf_edit=rcfl1.payload.signature",
    ],
  ])("for %s is %s", (domain, expected) => {
    const url = buildEditUrl(domain, CODE);

    expect(url).toBe(expected);
    // Nothing in the query, ever: the code is in the fragment only.
    expect(new URL(url!).search).toBe("");
  });

  it.each([null, "", "   ", "exa mple.com", "ftp://example.com"])(
    "is null for an unusable domain %p",
    (domain) => {
      expect(buildEditUrl(domain, CODE)).toBeNull();
    },
  );
});
