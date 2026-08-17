"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type SiteStatus } from "@/components/ui/status-badge";
import { DomainVerification } from "./DomainVerification";
import { SiteInstallationCard } from "./SiteInstallationCard";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Code,
  BarChart3,
  FileText,
  Activity,
  History,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Site } from "@/types";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { WebhooksPanel } from "./WebhooksPanel";
import { BulkOperations } from "./BulkOperations";
import { ShareButton } from "./ShareButton";
import { SiteEditorsCard } from "./SiteEditorsCard";
import { buildEmbedScript } from "@/lib/sites/embed-script";

export type { SiteStatus };

interface SiteWithDetails extends Site {
  stats?: {
    edits_count?: number;
    views?: number;
    content_elements_count?: number;
    last_activity?: string;
  };
  status?: SiteStatus;
  live_at?: string | null;
  last_reported_at?: string | null;
  last_mismatch_domain?: string | null;
  last_mismatch_at?: string | null;
  embedScript?: string;
  siteToken?: string;
}

interface SiteDetailViewProps {
  site: SiteWithDetails;
  onClose?: () => void;
}

interface StatTileProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * One tile treatment for all four stats. Each used to carry its own
 * decorative gradient (blue/cyan, purple/pink, yellow/orange, green/emerald),
 * which read as four unrelated statuses rather than four neutral counts.
 */
function StatTile({ label, value, icon: Icon }: StatTileProps) {
  return (
    <Card className="border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-sm text-muted-foreground">{label}</p>
            <p className="truncate text-2xl font-bold text-foreground">
              {value}
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SiteDetailView({ site }: SiteDetailViewProps) {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);

  const embedScript =
    site.embedScript ||
    buildEmbedScript({
      siteId: site.id,
      siteToken: site.siteToken || "YOUR_SITE_TOKEN",
    });

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(embedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleCopyToken = async () => {
    if (site.siteToken) {
      await navigator.clipboard.writeText(site.siteToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const lastActivity = site.stats?.last_activity
    ? formatDistanceToNow(new Date(site.stats.last_activity), {
        addSuffix: true,
      })
    : "No recent activity";

  return (
    <div className="space-y-6">
      {/* Site Information */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{site.name}</CardTitle>
              <CardDescription className="flex items-center space-x-2 mt-2">
                <span>{site.domain}</span>
                <a
                  href={`https://${site.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary transition-colors hover:text-primary/80"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <ShareButton site={site} variant="default" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryPanelOpen(true)}
              >
                <History className="w-4 h-4 mr-2" />
                History
              </Button>
              {/* The status pill moved into the Installation card below. It
                  used to sit here as well, next to a "Status" paragraph and an
                  "Integration Status" card, all three derived from the same
                  content_elements count and all three worded differently. */}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Created</p>
                <p className="text-sm text-foreground">
                  {formatDistanceToNow(new Date(site.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Last Updated
                </p>
                <p className="text-sm text-foreground">
                  {formatDistanceToNow(new Date(site.updated_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total Edits"
          value={site.stats?.edits_count ?? 0}
          icon={FileText}
        />
        <StatTile
          label="Page Views"
          value={site.stats?.views ?? 0}
          icon={BarChart3}
        />
        <StatTile
          label="Content Elements"
          value={site.stats?.content_elements_count ?? 0}
          icon={Code}
        />
        <StatTile label="Last Activity" value={lastActivity} icon={Activity} />
      </div>

      {/* Editors — the durable allowlist, distinct from the staging share link
          on the header button. */}
      <SiteEditorsCard siteId={site.id} siteName={site.name} />

      {/* The A/B testing card lived here. The feature is not being
          pursued, its route is disabled, and a card whose only control
          navigated to a 404 is worse than no card. The components and API
          routes are intact, so restoring this is a revert. */}

      {/* Embed Script */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Embed Script</CardTitle>
          <CardDescription>
            Add this script to your website to enable ReCopyFast features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-surface-1 rounded-lg p-4 border border-border">
              <code className="text-sm text-foreground break-all">
                {embedScript}
              </code>
            </div>
            <Button onClick={handleCopyScript} className="w-full">
              {copiedScript ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Embed Script
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Site Token */}
      {site.siteToken && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Site Token</CardTitle>
            <CardDescription>
              Use this token for API requests (keep it secure and never expose
              it publicly)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-surface-1 rounded-lg p-4 border border-border">
                <code className="text-sm text-foreground break-all font-mono">
                  {site.siteToken}
                </code>
              </div>
              <Button
                onClick={handleCopyToken}
                variant="outline"
                className="w-full"
              >
                {copiedToken ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Site Token
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Installation.
          This replaces the "Integration Status" card that stood here. Its
          "Script Installation" and "API Connection" rows were two differently
          worded readings of one `content_elements` count — which was itself a
          third reading of what the header pill already said. The card below is
          the single source, driven by the persisted state machine on `sites`
          rather than by a count. */}
      <SiteInstallationCard site={{ ...site, embedScript }} />

      {/* Domain ownership.
          `DomainVerification` and the `domain_verifications` table have existed
          since the security schema landed and the component was never mounted
          anywhere, so the only trace of the feature an owner could find was a
          status pill claiming their site was being verified. It lives here,
          under the integration it is adjacent to, prefilled with the domain the
          site already has. */}
      <Card className="border-border">
        <CardContent className="p-6">
          <DomainVerification siteId={site.id} siteDomain={site.domain} />
        </CardContent>
      </Card>

      {/* Outbound webhooks. Sits beside domain ownership because both are
          "how this site talks to the outside world", and because the config
          API, the delivery engine and its tables all existed with no surface
          an owner could reach — the same way DomainVerification did. */}
      <WebhooksPanel siteId={site.id} />
      {/* Content portability.
          Same story as the domain ownership panel above: `BulkOperations` and
          its three `/api/bulk/*` routes shipped together, and the component was
          imported by nothing — so the answer to "what happens to my copy if I
          leave" was an endpoint no owner could reach. It sits directly above
          the version history it writes to, because that adjacency is the
          reassurance an owner needs *before* running an import. It brings its
          own Card, unlike DomainVerification. */}
      <BulkOperations siteId={site.id} />

      {/* Version History Panel */}
      <VersionHistoryPanel
        open={historyPanelOpen}
        onClose={() => setHistoryPanelOpen(false)}
        siteId={site.id}
        stagingToken={site.siteToken || ""}
      />
    </div>
  );
}
