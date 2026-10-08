import * as React from "react";
import { PageHeader, type PageHeaderProps } from "@/components/ui/page-header";

/**
 * The page inside the dashboard frame (ADR 053). Every routed page under
 * `src/app/dashboard/` renders through exactly one of these, directly or
 * through one listed delegate (`AnalyticsDashboard`, `BillingDashboard`);
 * `src/__tests__/design/page-shell-guard.test.ts` fails the build otherwise.
 *
 * It owns the page, and only the page:
 * - the header: the page's one h1 (`PageHeader`), its eyebrow, meta,
 *   description and actions;
 * - an optional `nav` under the header (s66c's per-site sections);
 * - the vertical rhythm: 24px between the header and each section, 16px
 *   below 640.
 *
 * It never sets width, gutters or a max-width. `dashboard/layout.tsx` owns
 * those, and nothing else may. Billing is why: it nested its own
 * `container mx-auto px-4 py-8` inside the layout's column, in all five of
 * its states, and its title sat 16px right of every other page's until s66b1.
 * Two owners of the content box is how a page drifts off the shared edge.
 *
 * Every child is a section and starts at the content's left edge. Do not wrap
 * the sections in one extra div: the layout harness checks the left edge of
 * each direct child of `[data-page-shell]`, and one wrapper would make that
 * check pass vacuously.
 *
 * No slot beyond these six without an amendment to ADR 053.
 */
export interface PageShellProps extends PageHeaderProps {
  /** Rendered directly under the header, inside the shell's rhythm. */
  nav?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageShell({
  title,
  eyebrow,
  meta,
  description,
  actions,
  nav,
  children,
}: PageShellProps) {
  return (
    <div data-page-shell className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <PageHeader
        title={title}
        eyebrow={eyebrow}
        meta={meta}
        description={description}
        actions={actions}
      />
      {nav}
      {children}
    </div>
  );
}
