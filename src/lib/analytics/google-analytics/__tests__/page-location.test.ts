/**
 * @jest-environment node
 */

/**
 * s107 — what a page URL may say to Google.
 *
 * GA4 records `page_location`. Left alone it is `location.href` minus the
 * fragment, query string included — and the query strings on this site carry
 * a visitor's own figures (the s98 calculator), a legacy edit credential
 * (`?rcf_edit_token=`, ADR 055's tombstone) or whatever a link-sharer pasted.
 * Only campaign parameters are kept, and only on the landing page view: a
 * client-side navigation is internal, and its UTMs would overwrite the
 * session's real source.
 */

import { EDIT_LINK_FRAGMENT_KEY } from "@/lib/auth/edit-link";
import { sanitizePageLocation } from "@/lib/analytics/google-analytics/page-location";

const BASE = "https://www.recopyfa.st";

describe("sanitizePageLocation", () => {
  it("keeps origin and path", () => {
    expect(sanitizePageLocation(`${BASE}/compare/webflow-editor`)).toBe(
      `${BASE}/compare/webflow-editor`,
    );
  });

  it(`drops the fragment, so an edit link (#${EDIT_LINK_FRAGMENT_KEY}=) never leaves`, () => {
    expect(
      sanitizePageLocation(`${BASE}/#${EDIT_LINK_FRAGMENT_KEY}=v1.secret-code`),
    ).toBe(`${BASE}/`);
    expect(sanitizePageLocation(`${BASE}/pricing#pricing`)).toBe(
      `${BASE}/pricing`,
    );
  });

  it("drops every query key that is not utm_*", () => {
    expect(
      sanitizePageLocation(
        `${BASE}/tools/website-maintenance-cost?sites=10&rate=60&billed=0&currency=USD`,
      ),
    ).toBe(`${BASE}/tools/website-maintenance-cost`);
    expect(
      sanitizePageLocation(`${BASE}/?rcf_edit_token=secret&gclid=abc&fbclid=x`),
    ).toBe(`${BASE}/`);
  });

  it("keeps utm_* parameters, in their order, on a landing page view", () => {
    expect(
      sanitizePageLocation(
        `${BASE}/blog/post?ref=x&utm_source=newsletter&utm_medium=email&email=a@b.co&utm_campaign=launch`,
        { keepCampaign: true },
      ),
    ).toBe(
      `${BASE}/blog/post?utm_source=newsletter&utm_medium=email&utm_campaign=launch`,
    );
  });

  it("keeps campaign parameters by default (the landing case)", () => {
    expect(sanitizePageLocation(`${BASE}/?utm_source=x`)).toBe(
      `${BASE}/?utm_source=x`,
    );
  });

  it("drops utm_* too on a client-side navigation", () => {
    expect(
      sanitizePageLocation(
        `${BASE}/try?utm_source=tools&utm_medium=free_tool#install`,
        { keepCampaign: false },
      ),
    ).toBe(`${BASE}/try`);
  });

  it("drops a utm_* value that holds an email address", () => {
    expect(
      sanitizePageLocation(
        `${BASE}/?utm_source=mail&utm_content=jane.doe%40example.com`,
      ),
    ).toBe(`${BASE}/?utm_source=mail`);
  });

  it("matches utm_ case-sensitively, as GA does", () => {
    expect(sanitizePageLocation(`${BASE}/?UTM_SOURCE=x&Utm_medium=y`)).toBe(
      `${BASE}/`,
    );
  });

  it("caps a utm_* value at 100 characters", () => {
    const long = "a".repeat(150);
    expect(sanitizePageLocation(`${BASE}/?utm_campaign=${long}`)).toBe(
      `${BASE}/?utm_campaign=${"a".repeat(100)}`,
    );
  });

  it("replaces a UUID path segment, so a capability URL (an s96 report) is never sent", () => {
    expect(
      sanitizePageLocation(
        `${BASE}/tools/broken-links/r/0B1F3C2E-1111-4111-8111-111111111111`,
      ),
    ).toBe(`${BASE}/tools/broken-links/r/[id]`);
  });

  it("drops credentials in the authority", () => {
    expect(sanitizePageLocation("https://user:pass@www.recopyfa.st/")).toBe(
      `${BASE}/`,
    );
  });

  it.each(["", "not a url", "javascript:alert(1)", "/relative/path"])(
    "returns null for %j rather than guessing",
    (raw) => {
      expect(sanitizePageLocation(raw)).toBeNull();
    },
  );
});
