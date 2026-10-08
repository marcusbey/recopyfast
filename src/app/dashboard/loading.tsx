import { PageShell } from "@/components/ui/page-shell";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

/**
 * Skeleton for the dashboard segment. Next renders it in place of whichever
 * dashboard page is pending, inside the layout, so it is a page too: it
 * renders through `PageShell` with one neutral h1 (ADR 053), never a titleless
 * screen. Below the header it mirrors the overview layout — one lead metric
 * with three subordinate ones beside it, then the sites panel — so the page
 * does not shift once data arrives. The skeleton is the shell's one section.
 */
export default function DashboardLoading() {
  return (
    <PageShell title="Loading…">
      <div className="space-y-8" role="status" aria-label="Loading dashboard">
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
    </PageShell>
  );
}
