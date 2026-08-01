import { Card, CardContent } from "@/components/ui/card";

/**
 * Skeleton for the dashboard segment. Mirrors the overview layout (heading,
 * four stat cards, sites panel) so the page does not shift once data arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse" role="status" aria-label="Loading">
      <div>
        <div className="h-8 w-64 bg-muted rounded mb-3" />
        <div className="h-4 w-96 max-w-full bg-muted rounded" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-muted rounded" />
                  <div className="h-7 w-16 bg-muted rounded" />
                </div>
                <div className="w-12 h-12 bg-muted rounded-xl" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border">
        <CardContent className="p-6 space-y-4">
          <div className="h-5 w-32 bg-muted rounded" />
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="w-10 h-10 bg-muted rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-muted rounded" />
                <div className="h-3 w-56 max-w-full bg-muted rounded" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
