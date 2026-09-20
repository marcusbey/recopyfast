import type { Locator, Page } from "@playwright/test";

/**
 * During App Router hydration the document briefly exposed two `#pricing`
 * sections to Playwright. A document-wide id lookup therefore failed strict
 * mode before any assertion timeout could help. The rendered product surface
 * has one semantic main landmark; anchoring there selects the route-owned
 * pricing section and ignores the transient duplicate outside that landmark.
 */
export function pricingSection(page: Page): Locator {
  return page.getByRole("main").locator("#pricing");
}
