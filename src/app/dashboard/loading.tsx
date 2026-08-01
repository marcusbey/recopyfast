import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

/**
 * Skeleton for the dashboard segment. Mirrors the overview layout — header,
 * one lead metric with three subordinate ones beside it, then the sites panel —
 * so the page does not shift once data arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading dashboard">
      <div className="space-y-2.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border border-border p-6 lg:row-span-3">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex items-start justify-between gap-4 rounded-xl border border-border px-5 py-4 lg:col-start-2"
          >
            <div className="space-y-2.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-7 w-14" />
            </div>
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border">
        <div className="border-b border-border px-6 py-5">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="px-6 py-5">
          <SkeletonList rows={3} label="Loading sites" />
        </div>
      </div>

      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
