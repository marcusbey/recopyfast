"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import {
  useSiteActivation,
  type SiteActivationProgress,
} from "@/hooks/useSiteActivation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteStatus } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils/cn";
import { sitePageHref } from "@/components/dashboard/site/SiteSubnav";
import { AddEditorDialog } from "./AddEditorDialog";
import EditWebsiteButton from "./EditWebsiteButton";
import { InstallStep, type InstallStepState } from "./InstallStep";

/** What the quick setup needs of a site: `GET /api/sites`'s own fields. */
export interface QuickSetupSite {
  id: string;
  name: string;
  domain: string;
  status?: SiteStatus;
  live_at?: string | null;
  last_reported_at?: string | null;
}

interface QuickSetupPanelProps {
  site: QuickSetupSite;
  /** The install snippet the provider currently shows (ADR 052). */
  embedScript: string;
  userId: string;
}

type QuickSetupProps =
  | ({ variant?: "full" } & QuickSetupPanelProps)
  | { variant: "summary"; site: QuickSetupSite; userId: string };

const STEP_COUNT = 3;
const STEP_TITLES = { 2: "Install the snippet", 3: "Start editing" } as const;
const START_EDITING_LINE =
  "Edit the copy yourself, or add the person who will.";

/**
 * The quick setup's progress, from the server only (s66c2 AC 1).
 *
 * Step 1 is always done: the site exists. Step 2 is done when `/activation`
 * says `installed`, or when the site's own status has left
 * `awaiting-install`. Step 3 is done when an editor with Publish was added or
 * an edit was published. Nothing is kept in the browser: leaving the Overview
 * and coming back lands on the first incomplete step because the server says
 * so, not because a tab remembered it.
 */
function deriveProgress(site: QuickSetupSite, data: SiteActivationProgress) {
  const isInstalled =
    data.installed ||
    (site.status !== undefined && site.status !== "awaiting-install");
  const hasStartedEditing = data.invited || data.published;
  const currentStep: 2 | 3 = !isInstalled ? 2 : 3;
  const stateOf = (step: 2 | 3, isDone: boolean): InstallStepState =>
    isDone ? "done" : currentStep === step ? "current" : "next";

  return {
    // Done means Live (owner decision, 2026-10-08): the site has reported in.
    // This replaces s35's completion card, which waited for an invited
    // publisher and a published edit as well.
    isComplete: isInstalled,
    // Step 3 stays offered after Live until it is done or hidden; then the
    // panel leaves the page. Before Live it never finishes setup on its own.
    isFinished: isInstalled && hasStartedEditing,
    currentStep,
    installState: stateOf(2, isInstalled),
    editingState: stateOf(3, hasStartedEditing),
  };
}

/** When ReCopyFast last heard from the site, in words, if it knows. */
function lastSeen(site: QuickSetupSite): string | null {
  const value = site.last_reported_at ?? site.live_at;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Step 2's live status row. It reads the site the Overview hands down, which
 * is the provider's record (ADR 052): the provider re-polls `GET /api/sites`
 * every 5 s while the site awaits install, so the row turns to "Installed"
 * on that poll, with no reload and no extra request of its own. The 5 s is
 * the provider's, which is why the copy can promise it.
 */
function InstallStatusRow({
  site,
  isInstalled,
}: {
  site: QuickSetupSite;
  isInstalled: boolean;
}) {
  if (isInstalled) {
    const seen = lastSeen(site);
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-container border border-tone-success-border bg-tone-success-surface px-3 py-2.5 text-sm text-tone-success-text"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          Installed. ReCopyFast saw {site.domain}
          {seen ? ` ${seen}` : ""}.
        </span>
      </p>
    );
  }

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-container border border-tone-neutral-border bg-tone-neutral-surface px-3 py-2.5 text-sm text-tone-neutral-text"
    >
      <Loader2
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin"
        aria-hidden="true"
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Waiting for the first page view on {site.domain}. Checking every 5
        seconds.
      </span>
    </p>
  );
}

/**
 * The guided path for a new site (s66c2). It replaces the activation
 * checklist: the same `useSiteActivation` data, the same dismissal endpoint,
 * the same loading and error states.
 *
 * - `full`, on the site's Overview: three steps whose markers are the
 *   registration panel's (`InstallStep`), only the current one expanded.
 * - `summary`, on `/dashboard`: one row per unfinished site, "Continue
 *   setup" to that Overview. The dashboard used to stack a whole checklist
 *   per admin site above its summary.
 */
export function QuickSetup(props: QuickSetupProps) {
  if (props.variant === "summary") {
    return <QuickSetupSummaryRow site={props.site} userId={props.userId} />;
  }
  return (
    <QuickSetupPanel
      site={props.site}
      embedScript={props.embedScript}
      userId={props.userId}
    />
  );
}

/**
 * One `<li>` of the dashboard's quick-setup list, or nothing once the site's
 * setup is done or hidden. The steps themselves live on the site's Overview;
 * this row only says where the owner left off and takes them back there.
 */
function QuickSetupSummaryRow({
  site,
  userId,
}: {
  site: QuickSetupSite;
  userId: string;
}) {
  const { data, loading, error, refetch } = useSiteActivation({
    siteId: site.id,
    userId,
  });

  if (loading && !data) {
    return (
      <li className="px-4 py-3">
        <div role="status" aria-label={`Loading quick setup for ${site.name}`}>
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
      </li>
    );
  }

  if (error || !data) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <p className="flex min-w-0 items-center gap-2 text-sm text-tone-danger-text">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="[overflow-wrap:anywhere]">
            Could not load setup progress for {site.name}
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Try quick setup again for ${site.name}`}
          onClick={() => void refetch()}
        >
          Try again
        </Button>
      </li>
    );
  }

  const progress = deriveProgress(site, data);
  if (data.dismissed || progress.isFinished) return null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
        <span className="font-medium text-foreground">{site.name}</span>
        <span className="text-muted-foreground">
          {` · Step ${progress.currentStep} of ${STEP_COUNT}: ${STEP_TITLES[progress.currentStep]}`}
        </span>
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={sitePageHref(site.id)}>Continue setup</Link>
      </Button>
    </li>
  );
}

type QuickSetupProgress = ReturnType<typeof deriveProgress>;

function QuickSetupPanel({ site, embedScript, userId }: QuickSetupPanelProps) {
  const { data, loading, error, refetch, dismiss, dismissing, dismissError } =
    useSiteActivation({ siteId: site.id, userId });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleDismiss = async () => {
    setActionError(null);
    try {
      await dismiss();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not save dismissal",
      );
    }
  };

  const openInvite = () => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    setInviteOpen(true);
  };

  const renderPanel = () => {
    if (loading && !data) return <PanelLoading siteName={site.name} />;
    if (error || !data) {
      return (
        <PanelLoadError
          siteName={site.name}
          message={error}
          onRetry={() => void refetch()}
        />
      );
    }

    const progress = deriveProgress(site, data);
    if (data.dismissed || progress.isFinished) return null;
    const message = actionError || dismissError;

    return (
      <Card className="border-border">
        <PanelHeader
          siteName={site.name}
          progress={progress}
          isHiding={dismissing}
          onHide={() => void handleDismiss()}
        />
        <div className="space-y-4 px-4 pb-5 pt-2 sm:px-6">
          {message && (
            <Alert variant="destructive" className="mt-3">
              <AlertTitle>{site.name}</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <ol className="divide-y divide-border">
            <InstallStep
              number={1}
              title="Site added"
              state="done"
              className="py-3"
            >
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {site.name} · {site.domain}
              </p>
            </InstallStep>
            <InstallSnippetStep
              site={site}
              embedScript={embedScript}
              state={progress.installState}
            />
            <StartEditingStep
              site={site}
              state={progress.editingState}
              onEditError={setActionError}
              onAddEditor={openInvite}
            />
          </ol>
        </div>
      </Card>
    );
  };

  return (
    <>
      {/* Always mounted: focus returns here when the invite finishes a step
          and removes the button that opened it. Empty once setup is done or
          hidden, and then not drawn at all: an empty child of the page shell
          is still a flex item, and the shell's gap would be drawn twice
          (s66b1 review m-6). */}
      <div
        ref={surfaceRef}
        role="region"
        aria-label={`Quick setup for ${site.name}`}
        tabIndex={-1}
        className="empty:hidden"
      >
        {renderPanel()}
      </div>

      {/* Keep this dialog outside every quick-setup state. The invite itself
          can finish a step, and a background refetch can fail; neither event
          may discard the delivery notice or manual hub link. */}
      <AddEditorDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        siteId={site.id}
        siteName={site.name}
        defaultPermissions={["view", "edit", "publish"]}
        onAdded={() => {
          void refetch();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = previouslyFocusedRef.current;
          // Finishing a step removes the Add editor button while the dialog
          // is open. Focus then returns to the panel instead of falling
          // through to the document body.
          if (previous?.isConnected) previous.focus();
          else surfaceRef.current?.focus();
        }}
      />
    </>
  );
}

function PanelLoading({ siteName }: { siteName: string }) {
  return (
    <Card
      className="border-border"
      role="status"
      aria-label={`Loading quick setup for ${siteName}`}
    >
      <CardContent className="space-y-4 p-6">
        <Skeleton className="h-6 w-56" />
        {Array.from({ length: STEP_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** Never guessed progress: the server's answer, or this and a retry. */
function PanelLoadError({
  siteName,
  message,
  onRetry,
}: {
  siteName: string;
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Could not load setup progress for {siteName}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message || "Could not load setup progress"}</p>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Try quick setup again for ${siteName}`}
          onClick={onRetry}
        >
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * "Quick setup · Step 2 of 3" while the site awaits install; once it is live,
 * "Setup complete — <name> is live" in the success tone, while step 3 is
 * still offered. "Hide quick setup" is the existing, server-side dismissal.
 */
function PanelHeader({
  siteName,
  progress,
  isHiding,
  onHide,
}: {
  siteName: string;
  progress: QuickSetupProgress;
  isHiding: boolean;
  onHide: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b px-4 pb-4 pt-5 sm:px-6",
        progress.isComplete
          ? "border-tone-success-border bg-tone-success-surface"
          : "border-border",
      )}
    >
      <div className="min-w-0">
        {progress.isComplete ? (
          <>
            <h2 className="text-base font-semibold leading-6 text-tone-success-text [overflow-wrap:anywhere]">
              Setup complete — {siteName} is live
            </h2>
            <p className="text-sm text-muted-foreground">
              One more step, whenever you are ready.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold leading-6 text-foreground">
              Quick setup
            </h2>
            <p className="text-sm text-muted-foreground">
              Step {progress.currentStep} of {STEP_COUNT}
            </p>
          </>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onHide} disabled={isHiding}>
        Hide quick setup
      </Button>
    </div>
  );
}

/**
 * Step 2: the snippet, where it goes, and the live status row. Collapsed
 * once done, to the status row alone.
 */
function InstallSnippetStep({
  site,
  embedScript,
  state,
}: {
  site: QuickSetupSite;
  embedScript: string;
  state: InstallStepState;
}) {
  return (
    <InstallStep
      number={2}
      title="Install the snippet"
      state={state}
      className="py-3"
    >
      {state === "current" && (
        <>
          <CodeBlock
            value={embedScript}
            label="HTML"
            copyLabel="Copy snippet"
          />
          <p className="text-sm text-muted-foreground">
            Paste it just before{" "}
            <code className="font-mono text-xs text-foreground">
              {"</body>"}
            </code>{" "}
            on every page you want to edit.{" "}
            <Link
              href={sitePageHref(site.id, "install")}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Platform instructions
            </Link>
          </p>
        </>
      )}
      <InstallStatusRow site={site} isInstalled={state === "done"} />
    </InstallStep>
  );
}

/** Step 3: edit the copy yourself, or add the person who will. */
function StartEditingStep({
  site,
  state,
  onEditError,
  onAddEditor,
}: {
  site: QuickSetupSite;
  state: InstallStepState;
  onEditError: (message: string | null) => void;
  onAddEditor: () => void;
}) {
  return (
    <InstallStep
      number={3}
      title="Start editing"
      state={state}
      className="py-3"
    >
      {state !== "done" && (
        <p className="text-sm text-muted-foreground">{START_EDITING_LINE}</p>
      )}
      {state === "current" && (
        <div className="flex flex-wrap gap-2">
          {/* The stepper's own body, as the checklist's: it asks for
              publish, because the step it completes is a publish. A refusal
              reads with the panel's other messages, above the steps, never
              inside this row (s66c1 pre-PR fix). */}
          <EditWebsiteButton
            site={{ id: site.id, domain: site.domain, name: site.name }}
            userPermissions={["edit", "publish"]}
            onErrorChange={onEditError}
            aria-label={`Edit website: ${site.name}`}
          />
          <Button
            variant="outline"
            aria-label={`Add editor to ${site.name}`}
            onClick={onAddEditor}
          >
            <UserPlus aria-hidden="true" />
            Add editor
          </Button>
        </div>
      )}
    </InstallStep>
  );
}
