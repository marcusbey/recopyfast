import { render, type RenderResult } from "@testing-library/react";
import {
  SiteContext,
  type SiteContextValue,
  type SiteRecord,
} from "../SiteProvider";

/**
 * The provider stub every site page test renders inside (s66c1).
 *
 * Pages never take the site as a prop (ADR 052): they read it from
 * `SiteContext`. A page test therefore builds the context value here and
 * renders the page under it, so what the page shows can be driven from one
 * object without mocking `GET /api/sites`. The provider itself is tested
 * against a mocked fetch in `SiteProvider.test.tsx`.
 *
 * Not a suite: jest collects only `*.test.*`.
 */

export const FIXTURE_TOKEN = "fixture-site-token";
export const FIXTURE_SNIPPET =
  '<script src="https://app.example/embed/recopyfast.js" data-site-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" data-site-token="fixture-site-token"></script>';

export function buildSite(overrides: Partial<SiteRecord> = {}): SiteRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    domain: "acme.example",
    name: "Acme marketing site",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    status: "live",
    live_at: "2026-09-02T00:00:00Z",
    last_reported_at: "2026-10-07T00:00:00Z",
    last_mismatch_domain: null,
    stats: {
      edits_count: 42,
      views: 0,
      content_elements_count: 15,
      last_activity: "2026-10-07T00:00:00Z",
    },
    // The owner by default: their own grant, as `GET /api/sites` reports it
    // (PR #72 review, D1), with the credentials it mints for admins only.
    permission: "admin",
    siteToken: FIXTURE_TOKEN,
    embedScript: FIXTURE_SNIPPET,
    ...overrides,
  };
}

export function buildSiteContext(
  overrides: Partial<SiteContextValue> & { site?: SiteRecord } = {},
): SiteContextValue {
  const site = overrides.site ?? buildSite();
  return {
    site,
    isAdmin: Boolean(site.siteToken),
    refetch: jest.fn(async () => {}),
    credentials: { siteToken: site.siteToken, embedScript: site.embedScript },
    regenerateSnippet: jest.fn(async () => true),
    regeneration: { isPending: false, error: null, hasSucceeded: false },
    clearRegenerationError: jest.fn(),
    ...overrides,
  };
}

export function renderWithSite(
  ui: React.ReactElement,
  value: SiteContextValue = buildSiteContext(),
): RenderResult & { value: SiteContextValue } {
  const result = render(
    <SiteContext.Provider value={value}>{ui}</SiteContext.Provider>,
  );
  return {
    ...result,
    value,
    rerender: (next: React.ReactNode) =>
      result.rerender(
        <SiteContext.Provider value={value}>{next}</SiteContext.Provider>,
      ),
  };
}
