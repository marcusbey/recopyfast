"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  UserPlus,
} from "lucide-react";
import { useSiteActivation } from "@/hooks/useSiteActivation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveSiteStatus, StatusBadge } from "@/components/ui/status-badge";
import { AddEditorDialog } from "./AddEditorDialog";
import EditWebsiteButton from "./EditWebsiteButton";

interface ActivationChecklistProps {
  siteId: string;
  siteName: string;
  domain: string;
  embedScript: string;
  userId: string;
}

const completeStatus = {
  label: "Complete",
  tone: "success" as const,
  icon: CheckCircle2,
  description: "This activation step is complete.",
};

export function ActivationChecklist({
  siteId,
  siteName,
  domain,
  embedScript,
  userId,
}: ActivationChecklistProps) {
  const { data, loading, error, refetch, dismiss, dismissing, dismissError } =
    useSiteActivation({ siteId, userId });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const activationSurfaceRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isComplete = Boolean(data?.installed && data.invited && data.published);

  const handleCopy = async () => {
    setActionError(null);
    setCopyNotice(null);
    try {
      await navigator.clipboard.writeText(embedScript);
      setCopyNotice("Snippet copied");
    } catch {
      setActionError("Could not copy the snippet. Try again.");
    }
  };

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

  const steps = data
    ? [
        {
          label: "Install detected",
          complete: data.installed,
          action: (
            <Button
              size="sm"
              aria-label={`Copy snippet for ${siteName}`}
              onClick={() => void handleCopy()}
            >
              <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />
              Copy snippet
            </Button>
          ),
        },
        // s66c1: "Invite a client" was the Editors card under a third name.
        // The step is now the same "Add editor" People & access offers, with
        // the checklist's View+Edit+Publish preset (s35).
        {
          label: "Add editor",
          complete: data.invited,
          action: (
            <Button
              size="sm"
              aria-label={`Add editor to ${siteName}`}
              onClick={openInvite}
            >
              <UserPlus aria-hidden="true" />
              Add editor
            </Button>
          ),
        },
        // The one "Edit website" control, with the checklist's own body: it
        // asks for publish, because the step it completes is a publish. A
        // refusal reads with the checklist's other messages, above the steps:
        // drawn by the button, it sat inside the step's row beside "Not yet"
        // (s66c1 pre-PR fix).
        {
          label: "An edit published",
          complete: data.published,
          action: (
            <EditWebsiteButton
              site={{ id: siteId, domain, name: siteName }}
              userPermissions={["edit", "publish"]}
              onErrorChange={setActionError}
              size="sm"
              aria-label={`Edit website: ${siteName}`}
            />
          ),
        },
      ]
    : [];

  return (
    <>
      <div
        ref={activationSurfaceRef}
        role="region"
        aria-label={`Activation for ${siteName}`}
        tabIndex={-1}
      >
        {loading && !data ? (
          <Card
            className="border-border"
            role="status"
            aria-label={`Loading activation for ${siteName}`}
          >
            <CardContent className="space-y-4 p-6">
              <Skeleton className="h-6 w-56" />
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : error || !data ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>
              Could not load activation progress for {siteName}
            </AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{error || "Could not load activation progress"}</p>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Try activation again for ${siteName}`}
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : isComplete ? (
          <Card className="border-tone-success-border bg-tone-success-surface">
            <CardContent className="flex items-center justify-between gap-4 p-6">
              <div>
                <h3 className="text-title text-foreground">{siteName}</h3>
                <p className="text-sm text-muted-foreground">
                  Site installed, an active invited editor has Publish
                  permission, and an edit has been published.
                </p>
              </div>
              <StatusBadge status={resolveSiteStatus("live")} />
            </CardContent>
          </Card>
        ) : data.dismissed ? null : (
          <Card className="border-border">
            <CardHeader className="gap-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-title">
                    Get {siteName} publishing
                  </CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDismiss()}
                  disabled={dismissing}
                  aria-label={`Dismiss activation checklist for ${siteName}`}
                >
                  Dismiss checklist
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {(actionError || dismissError) && (
                <Alert variant="destructive">
                  <AlertTitle>{siteName}</AlertTitle>
                  <AlertDescription>
                    {actionError || dismissError}
                  </AlertDescription>
                </Alert>
              )}
              {copyNotice && (
                <Alert variant="success">
                  <AlertDescription>{copyNotice}</AlertDescription>
                </Alert>
              )}
              <ol className="space-y-3">
                {steps.map((step) => (
                  <li
                    key={step.label}
                    className="flex flex-col gap-3 rounded-container border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {step.label}
                    </span>
                    {step.complete ? (
                      <StatusBadge status={completeStatus} />
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          Not yet
                        </span>
                        {step.action}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Keep this dialog outside every activation-state branch. The invite
          itself can complete the checklist, and a background refetch can fail;
          neither event may discard the delivery notice or manual hub link. */}
      <AddEditorDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        siteId={siteId}
        siteName={siteName}
        defaultPermissions={["view", "edit", "publish"]}
        onAdded={() => {
          void refetch();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = previouslyFocusedRef.current;
          // Completion removes the invite button while the dialog is open.
          // In that case focus returns to the replacement Live/error region
          // instead of falling through to the document body.
          if (previous?.isConnected) previous.focus();
          else activationSurfaceRef.current?.focus();
        }}
      />
    </>
  );
}
