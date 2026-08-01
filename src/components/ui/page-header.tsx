import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Every `/dashboard` sub-page opens with this, so the eye lands in the same
 * place on every screen. Title, one line of orientation, actions on the right.
 */
interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small uppercase label above the title — section or breadcrumb context. */
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-display">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
