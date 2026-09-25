"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useSiteActivation } from "@/hooks/useSiteActivation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveSiteStatus, StatusBadge } from "@/components/ui/status-badge";
import { SiteEditorsCard } from "./SiteEditorsCard";

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

function registeredHostname(domain: string): string | null {
  try {
    return new URL(domain.includes("://") ? domain : `https://${domain}`)
      .hostname;
  } catch {
    return null;
  }
}

function validEditUrl(value: unknown, domain: string): string | null {
  if (typeof value !== "string") return null;
  const registered = registeredHostname(domain);
  if (!registered) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.toLowerCase() !== registered.toLowerCase()) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function ActivationChecklist({
  siteId,
  siteName,
  domain,
  embedScript,
  userId,
}: ActivationChecklistProps) {
  const { data, loading, error, refresh, dismiss, dismissing, dismissError } =
    useSiteActivation({ siteId, userId });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingEdit, setOpeningEdit] = useState(false);

  if (loading && !data) {
    return (
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
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Could not load activation progress</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error || "Could not load activation progress"}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const isComplete = data.installed && data.invited && data.published;
  if (isComplete) {
    return (
      <Card className="border-tone-success-border bg-tone-success-surface">
        <CardContent className="flex items-center justify-between gap-4 p-6">
          <div>
            <p className="text-title text-foreground">{siteName}</p>
            <p className="text-sm text-muted-foreground">
              Your client publishing flow is ready.
            </p>
          </div>
          <StatusBadge status={resolveSiteStatus("live")} />
        </CardContent>
      </Card>
    );
  }

  if (data.dismissed) return null;

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

  const handleEdit = async () => {
    // Browsers associate popup permission with the synchronous click. Opening
    // only after the network round trip loses that activation and turns a
    // healthy edit-session response into a blocked popup.
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setActionError("Allow popups for ReCopyFast, then try again.");
      return;
    }
    popup.opener = null;
    setOpeningEdit(true);
    setActionError(null);
    try {
      const response = await fetch("/api/edit-sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          permissions: ["edit", "publish"],
          durationHours: 2,
        }),
      });
      const body: { editUrl?: unknown; error?: unknown } =
        await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "Could not open edit mode",
        );
      }
      const editUrl = validEditUrl(body.editUrl, domain);
      if (!editUrl)
        throw new Error("The server did not return a valid edit link.");

      popup.location.href = editUrl;
    } catch (caught) {
      popup.close();
      setActionError(
        caught instanceof Error ? caught.message : "Could not open edit mode",
      );
    } finally {
      setOpeningEdit(false);
    }
  };

  const steps = [
    {
      label: "Install detected",
      complete: data.installed,
      action: (
        <Button size="sm" onClick={() => void handleCopy()}>
          <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy snippet
        </Button>
      ),
    },
    {
      label: "Invite a client",
      complete: data.invited,
      action: (
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          Invite a client
        </Button>
      ),
    },
    {
      label: "First published edit",
      complete: data.published,
      action: (
        <Button
          size="sm"
          onClick={() => void handleEdit()}
          disabled={openingEdit}
        >
          {openingEdit ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Open site in edit mode
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card className="border-border">
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{siteName}</p>
              <CardTitle className="text-title">
                Get your client publishing
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDismiss()}
              disabled={dismissing}
            >
              Dismiss checklist
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(actionError || dismissError) && (
            <Alert variant="destructive">
              <AlertDescription>{actionError || dismissError}</AlertDescription>
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
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm font-medium text-foreground">
                  {step.label}
                </span>
                {step.complete ? (
                  <StatusBadge status={completeStatus} />
                ) : (
                  step.action
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invite a client</DialogTitle>
            <DialogDescription>
              Add the person who will edit and publish {siteName}.
            </DialogDescription>
          </DialogHeader>
          <SiteEditorsCard
            siteId={siteId}
            siteName={siteName}
            inviteFormAutoFocus
            onEditorChange={() => {
              void refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
