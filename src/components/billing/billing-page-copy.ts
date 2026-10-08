/**
 * The Billing page's header copy, shared by the page's server-rendered
 * Suspense fallback (`app/dashboard/billing/page.tsx`) and the client
 * `BillingDashboard` that replaces it. Both paint the same `PageShell`
 * header, so the title does not move on hand-off (s66b1, ADR 053).
 *
 * A plain module on purpose: no "use client". The page is a server
 * component, and a constant exported from a "use client" module arrives there
 * as a client reference, not a string. The copy used to be typed twice for
 * that reason, unpinned, and nothing would have failed when one side drifted
 * (s66b1 review m-4).
 */
export const BILLING_PAGE_COPY = {
  title: "Billing & subscription",
  description:
    "Manage your subscription, payment methods, and billing information",
} as const;
