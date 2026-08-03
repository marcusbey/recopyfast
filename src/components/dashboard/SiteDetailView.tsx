"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  StatusBadge,
  siteStatuses,
  type SiteStatus,
} from "@/components/ui/status-badge";
import {
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Code,
  BarChart3,
  FileText,
  Activity,
  History,
  FlaskConical,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import type { Site } from "@/types";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
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
  // Content elements only ever reach the database by the embed script POSTing
  // them from the customer's page, so a non-zero count is proof the script has
  // run at least once against the live API.
  const hasReportedContent = (site.stats?.content_elements_count ?? 0) > 0;

  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [activeTestCount, setActiveTestCount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/ab-tests?siteId=${site.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((tests: Array<{ status: string }>) => {
        setActiveTestCount(
          tests.filter((t) => t.status === "active" || t.status === "running")
            .length,
        );
      })
      .catch(() => setActiveTestCount(0));
  }, [site.id]);
  const status = site.status || "active";
  const statusDefinition = siteStatuses[status];

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
              <StatusBadge status={statusDefinition} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Status Description
              </p>
              <p className="text-sm text-foreground">
                {statusDefinition.description}
              </p>
            </div>
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

      {/* A/B Testing Summary */}
      <Card className="border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FlaskConical
                  className="h-5 w-5 text-primary"
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  A/B Copy Testing
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeTestCount === null
                    ? "Loading..."
                    : activeTestCount === 0
                      ? "No active tests"
                      : `${activeTestCount} active test${activeTestCount !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            {/* asChild keeps this a single <a>; wrapping a <button> in a link
                nests two interactive elements and breaks screen readers. */}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/ab-tests?siteId=${site.id}`}>
                Manage Tests
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

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

      {/* Integration Status */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle>Integration Status</CardTitle>
          <CardDescription>
            Current integration health and setup status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/*
              These two rows were hardcoded to "Verified" / "Connected", so a
              site whose script had never been installed still reported a
              healthy integration. The only first-party evidence the script ran
              is that it posted content elements back, so that is what drives
              the status now.
            */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-foreground">
                Script Installation
              </span>
              {hasReportedContent ? (
                <Badge variant="tone-success">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="tone-warning">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Not detected yet
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-foreground">API Connection</span>
              {hasReportedContent ? (
                <Badge variant="tone-success">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="tone-neutral">Awaiting first request</Badge>
              )}
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-foreground">Content Elements</span>
              <Badge variant="tone-info">
                {site.stats?.content_elements_count || 0} Found
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

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
