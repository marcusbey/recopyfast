import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A skeleton stands in for the shape of the content that is coming, so the
 * layout does not jump when it arrives. It is not a spinner in a box.
 *
 * Everything here is `aria-hidden`; the loading state is announced once by the
 * region that owns it, not once per bar.
 */

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div className={cn("skeleton", className)} aria-hidden="true" {...props} />
  );
}

interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of lines. The last line is shortened, the way real text ends. */
  lines?: number;
}

export function SkeletonText({
  lines = 3,
  className,
  ...props
}: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true" {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Matches the shape of a `Metric`: label, value, trailing tile. */
export function SkeletonMetric({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      aria-hidden="true"
    >
      <div className="space-y-2.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-7 w-14" />
      </div>
      <Skeleton className="h-9 w-9 rounded-lg" />
    </div>
  );
}

/** Matches the shape of one row in a list of sites or content elements. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border px-4 py-3.5",
        className,
      )}
      aria-hidden="true"
    >
      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-40 max-w-full" />
        <Skeleton className="h-2.5 w-24 max-w-full" />
      </div>
      <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
    </div>
  );
}

interface SkeletonListProps {
  rows?: number;
  className?: string;
  /** Announced once for the whole list rather than per row. */
  label?: string;
}

export function SkeletonList({
  rows = 3,
  className,
  label = "Loading",
}: SkeletonListProps) {
  return (
    <div
      className={cn("space-y-2", className)}
      role="status"
      aria-label={label}
    >
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </div>
  );
}
