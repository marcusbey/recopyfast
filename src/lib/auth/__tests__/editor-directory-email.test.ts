/**
 * s72 — one email rule, and it refuses an address that is not an address.
 *
 * `isPlausibleEmail` guards every address a site admin types for someone else
 * (a staging invite, a site editor) and every address an editor types to ask
 * for a code. Its old rule, `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, accepted
 * `<svg/onload=alert(1)>@x.co`: no whitespace needed. A staging invite's
 * address becomes a version's `created_by`, which the embed's History tab
 * rendered as markup on the customer's origin (s70a review F1). The embed now
 * renders it as text; this rule makes the address an address in the first
 * place — the WHATWG HTML "valid e-mail address" with a dotted domain whose
 * last label has two characters or more, at most 254 characters, the character
 * set Supabase Auth applies to its own users.
 */

import { isPlausibleEmail } from "../editor-directory";

const DOMAIN = "@example.com";
/** 254 characters: the longest address the rule accepts. */
const LONGEST = "a".repeat(254 - DOMAIN.length) + DOMAIN;
/** 255 characters, otherwise valid. */
const TOO_LONG = "a".repeat(255 - DOMAIN.length) + DOMAIN;

describe("isPlausibleEmail accepts a real address", () => {
  it.each([
    ["a plain address", "editor@example.com"],
    ["dots, a plus tag and a deep domain", "First.Last+tag@sub.example.co.uk"],
    ["an apostrophe", "o'brien@example.com"],
    ["the shortest dotted form", "a@b.co"],
    ["254 characters", LONGEST],
  ])("%s", (_case, email) => {
    expect(isPlausibleEmail(email)).toBe(true);
  });
});

describe("isPlausibleEmail refuses what is not an address", () => {
  it.each([
    ["an <img> payload", "<img/src/onerror=alert(1)>@x.co"],
    ["an <svg> payload", "<svg/onload=alert(1)>@x.co"],
    ["a quoted local part", '"quoted"@example.com'],
    ["a space", "a b@example.com"],
    ["a header-shaped line break", "a@b.co\r\nBcc: c@d.ef"],
    ["a dotless domain", "a@b"],
    ["a label that starts with a hyphen", "a@-b.co"],
    ["an empty label", "a@b..co"],
    ["a non-ASCII local part", "ä@example.com"],
    ["255 characters", TOO_LONG],
    ["the empty string", ""],
    ["a one-letter last label", "a@b.c"],
  ])("%s", (_case, email) => {
    expect(isPlausibleEmail(email)).toBe(false);
  });

  it("the length fixtures are the lengths they claim", () => {
    expect(LONGEST).toHaveLength(254);
    expect(TOO_LONG).toHaveLength(255);
  });
});
