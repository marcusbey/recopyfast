import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The top of every app page: the page's only h1, in `.text-page-title`.
 *
 * Render it through `PageShell`, never on its own (ADR 053). It existed for
 * months as a convention, and four title styles grew beside it; a second one
 * rendered outside the shell would also add a second h1 that the source guard
 * cannot see, because the `<h1` is written here. `page-shell-guard.test.ts`
 * therefore forbids `<PageHeader` anywhere but `ui/page-shell.tsx`.
 */
export interface PageHeaderProps {
  title: string;
  /** Small uppercase label above the title — section or breadcrumb context. */
  eyebrow?: string;
  /** Inline after the h1, on the title's row: a status badge, a count. */
  meta?: React.ReactNode;
  /** A node, not a string: s66c puts a site's domain link here. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/*
 * One grid, so the DOM order stays eyebrow → title → description → actions
 * (a screen reader hears what the page is before what it can do) while the
 * actions are drawn at the end of the title row from 640px up. Below 640 they
 * fall into their own row after the description, left-aligned, wrapping.
 *
 * No row gap: an absent slot leaves an empty `auto` track, and a gap would
 * still be drawn around it. The spacing is on the items instead.
 *
 * Actions are centred on the title row. They used to sit on the bottom of the
 * whole block, and at 768 a two-line description pushed the button down and
 * away from the title it acts on (s66b design, amendment).
 */
const HEADER_GRID = [
  "grid grid-cols-[minmax(0,1fr)] items-center gap-x-4",
  "[grid-template-areas:'eyebrow'_'title'_'description'_'actions']",
  "sm:grid-cols-[minmax(0,1fr)_auto]",
  "sm:[grid-template-areas:'eyebrow_eyebrow'_'title_actions'_'description_description']",
].join(" ");

export function PageHeader({
  title,
  eyebrow,
  meta,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header data-page-header className={HEADER_GRID}>
      {eyebrow && (
        <p className="text-eyebrow mb-2 [grid-area:eyebrow]">{eyebrow}</p>
      )}
      {/* `min-h-10`, centred: a 32px line of title and 40px buttons share
          one centre line instead of meeting at their bottoms. */}
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 [grid-area:title]">
        <h1 className="text-page-title min-w-0">{title}</h1>
        {meta}
      </div>
      {description && (
        <div className="mt-1 max-w-prose text-sm text-muted-foreground [grid-area:description]">
          {description}
        </div>
      )}
      {actions && (
        <div className="mt-4 flex flex-wrap items-center gap-2 [grid-area:actions] sm:mt-0 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}

/**
 * A titled block inside a page. Uses an h2 so the heading order under the
 * page's h1 stays correct for screen readers.
 */
interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-title">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
