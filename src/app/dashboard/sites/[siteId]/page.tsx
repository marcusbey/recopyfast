"use client";

import { useId } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, Code, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { Metric } from "@/components/ui/metric";
import { PageShell } from "@/components/ui/page-shell";
import { ActivationChecklist } from "@/components/dashboard/ActivationChecklist";
import { useSiteContext } from "@/components/dashboard/site/SiteProvider";
import { useSitePageShell } from "@/components/dashboard/site/useSitePageShell";

function relative(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * A site's Overview (s66c1 AC 9): the activation checklist, three figures,
 * and the site's details. s66c2 replaces the checklist with the quick setup.
 *
 * "Page views" is not one of the figures: `GET /api/sites` never computes
 * views (`views: 0`, with a TODO), and the old detail view showed that 0 as
 * if it were a measurement.
 */
export default function SiteOverviewPage() {
  const { shell, editWebsiteAlert } = useSitePageShell();
  const { site, credentials } = useSiteContext();
  const { user } = useAuth();
  const activityId = useId();
  const detailsId = useId();

  const lastActivity = relative(site.stats?.last_activity);

  return (
    <PageShell {...shell}>
      {editWebsiteAlert}
      {/* Admins only: the checklist's first step copies the install snippet,
          which `GET /api/sites` mints for admins alone. It reads the
          provider's credentials, so a rotation reaches it at once. */}
      {user?.id && credentials.siteToken && credentials.embedScript && (
        <ActivationChecklist
          key={`${user.id}:${site.id}`}
          siteId={site.id}
          siteName={site.name}
          domain={site.domain}
          embedScript={credentials.embedScript}
          userId={user.id}
        />
      )}

      <section aria-labelledby={activityId} className="space-y-3">
        <h2 id={activityId} className="text-eyebrow">
          Activity
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Metric
            label="Edits"
            value={String(site.stats?.edits_count ?? 0)}
            state="ready"
            icon={FileText}
          />
          <Metric
            label="Content elements"
            value={String(site.stats?.content_elements_count ?? 0)}
            state="ready"
            icon={Code}
          />
          <Metric
            label="Last activity"
            value={lastActivity ?? "No activity yet"}
            state="ready"
            icon={Activity}
          />
        </div>
      </section>

      <section aria-labelledby={detailsId}>
        <Card className="border-border">
          <CardHeader>
            <CardTitle id={detailsId}>Site details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">
                  {relative(site.created_at) ?? "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="text-foreground">
                  {relative(site.updated_at) ?? "Unknown"}
                </dd>
              </div>
            </dl>
            <CodeBlock
              value={site.id}
              label="Site ID"
              copyLabel="Copy site ID"
            />
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
