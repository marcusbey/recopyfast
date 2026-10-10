"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Lock, Users } from "lucide-react";
import {
  EditorNoticePanel,
  NETWORK_ERROR,
  readActionFailure,
  type EditorNotice,
} from "./AddEditorDialog";
import { SiteEditorRow, type SiteEditorSummary } from "./SiteEditorRow";

/**
 * The site's editors: `site_editors`, the durable allowlist that decides whose
 * email address may request a sign-in code for this site.
 *
 * s66c1 made it list-only: rows, resend, remove and the previously removed.
 * Enrolment moved to `AddEditorDialog`, opened by People & access's "Add
 * editor" (and by the activation checklist), so the product has one form for
 * it instead of two identical ones under two names. This is a different
 * concept from the preview links listed beside it: a share writes
 * `staging_access`, a time-boxed token for one review; an editor is a standing
 * permission that survives devices and sessions.
 */

interface SiteEditorsCardProps {
  siteId: string;
  siteName: string;
  onEditorChange?: () => void;
  /** Changes when an editor was just added elsewhere: load the list again. */
  reloadKey?: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; editors: SiteEditorSummary[] };

/** The same parse where only the prose is wanted. */
async function readEditorsError(
  response: Response,
  fallback: string,
): Promise<string> {
  return (await readActionFailure(response, fallback)).message;
}

export function SiteEditorsCard({
  siteId,
  siteName,
  onEditorChange,
  reloadKey = 0,
}: SiteEditorsCardProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<EditorNotice | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<SiteEditorSummary | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<{
    editorId: string;
    pending: boolean;
    error: string | null;
  } | null>(null);

  const loadEditors = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/editor/editors?siteId=${encodeURIComponent(siteId)}`,
      );

      // Not an error state: a manager who is not an admin of this site reaches
      // this card legitimately and simply cannot use it.
      if (response.status === 403) {
        setState({
          status: "forbidden",
          message: await readEditorsError(
            response,
            "Admin permission required",
          ),
        });
        return;
      }

      if (!response.ok) {
        setState({
          status: "error",
          message: await readEditorsError(response, "Could not load editors"),
        });
        return;
      }

      const data: { editors?: SiteEditorSummary[] } = await response.json();
      setState({ status: "ready", editors: data.editors ?? [] });
    } catch (error) {
      console.error("Failed to load site editors:", error);
      setState({ status: "error", message: NETWORK_ERROR });
    }
  }, [siteId]);

  // `reloadKey` is a dependency on purpose: People & access bumps it after
  // "Add editor" succeeds, so the new row appears without a page reload.
  useEffect(() => {
    loadEditors();
  }, [loadEditors, reloadKey]);

  const openRevokeConfirm = (editor: SiteEditorSummary) => {
    setRevokeError(null);
    setRevokeTarget(editor);
  };

  const handleResend = async (editor: SiteEditorSummary) => {
    setNotice(null);
    setResendState({ editorId: editor.id, pending: true, error: null });

    try {
      const response = await fetch("/api/editor/editors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, siteEditorId: editor.id }),
      });

      if (!response.ok) {
        setResendState({
          editorId: editor.id,
          pending: false,
          error: await readEditorsError(
            response,
            "Could not resend that invitation",
          ),
        });
        return;
      }

      const data: { invitationEmailSent?: boolean; hubUrl?: string } =
        await response.json();
      if (data.invitationEmailSent !== true) {
        setResendState(null);
        setNotice({
          kind: "invited",
          email: editor.email,
          hubUrl: typeof data.hubUrl === "string" ? data.hubUrl : "",
          invitationEmailSent: false,
          action: "resend",
        });
        return;
      }

      setResendState(null);
      setNotice({
        kind: "invited",
        email: editor.email,
        hubUrl: typeof data.hubUrl === "string" ? data.hubUrl : "",
        invitationEmailSent: true,
        action: "resend",
      });
    } catch (error) {
      console.error("Failed to resend editor invitation:", error);
      setResendState({
        editorId: editor.id,
        pending: false,
        error: NETWORK_ERROR,
      });
    }
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;

    setRevoking(true);
    setRevokeError(null);
    try {
      const response = await fetch(
        `/api/editor/editors?siteEditorId=${encodeURIComponent(revokeTarget.id)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        setRevokeError(
          await readEditorsError(response, "Could not remove that editor"),
        );
        return;
      }

      const data: { grantsRevoked?: number } = await response.json();
      setNotice({
        kind: "removed",
        email: revokeTarget.email,
        devicesSignedOut:
          typeof data.grantsRevoked === "number" ? data.grantsRevoked : 0,
      });
      setRevokeTarget(null);
      await loadEditors();
      onEditorChange?.();
    } catch (error) {
      console.error("Failed to revoke site editor:", error);
      setRevokeError(NETWORK_ERROR);
    } finally {
      setRevoking(false);
    }
  };

  // Revoked rows come back from the API for audit. They belong after the live
  // ones, not mixed into them — "who has access" must be answerable at a glance.
  const { activeEditors, revokedEditors } = useMemo(() => {
    const editors = state.status === "ready" ? state.editors : [];
    return {
      activeEditors: editors.filter((editor) => editor.revokedAt === null),
      revokedEditors: editors.filter((editor) => editor.revokedAt !== null),
    };
  }, [state]);

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle>
          {state.status === "ready"
            ? `Editors · ${activeEditors.length}`
            : "Editors"}
        </CardTitle>
        <CardDescription>
          People who can edit {siteName} by email, without a ReCopyFast account.
          They sign in at the editor hub with a one-time code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && <EditorNoticePanel notice={notice} />}

        {state.status === "loading" && (
          <div className="space-y-2" role="status" aria-label="Loading editors">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="space-y-3 rounded-container border border-border p-4"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="h-7 w-7" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
        )}

        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Could not load editors</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{state.message}</p>
              <Button onClick={loadEditors} variant="outline" size="sm">
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {state.status === "forbidden" && (
          <div className="flex items-start gap-3 rounded-container border border-border bg-surface-1 p-4">
            <Lock
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                You cannot manage editors on this site
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {state.message}
              </p>
            </div>
          </div>
        )}

        {state.status === "ready" && (
          <>
            {activeEditors.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No editors yet"
                description={`Nobody outside your account can edit ${siteName}. Add someone by the email address they already use.`}
                steps={[
                  "Choose Add editor above.",
                  "They open the editor hub and request a sign-in code.",
                  "The code arrives by email and signs that device in.",
                ]}
              />
            ) : (
              <ul className="space-y-3">
                {activeEditors.map((editor) => (
                  <SiteEditorRow
                    key={editor.id}
                    editor={editor}
                    onRevoke={openRevokeConfirm}
                    onResend={handleResend}
                    isResending={
                      resendState?.editorId === editor.id && resendState.pending
                    }
                    resendError={
                      resendState?.editorId === editor.id
                        ? resendState.error
                        : null
                    }
                  />
                ))}
              </ul>
            )}

            {revokedEditors.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Previously removed
                </p>
                <ul className="space-y-3">
                  {revokedEditors.map((editor) => (
                    <SiteEditorRow
                      key={editor.id}
                      editor={editor}
                      onRevoke={openRevokeConfirm}
                      onResend={handleResend}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {revokeTarget?.email}?</DialogTitle>
            {/* Stating the device count before the click, not after it: this
                action signs those sessions out in the same request, and the
                number is the only part of it the owner cannot otherwise see. */}
            <DialogDescription>
              They lose access to {siteName} immediately.{" "}
              {revokeTarget && revokeTarget.activeDevices > 0
                ? `${revokeTarget.activeDevices} signed-in ${
                    revokeTarget.activeDevices === 1 ? "device" : "devices"
                  } will be signed out in the same step, and any editing in progress there stops.`
                : "They have no signed-in devices right now."}{" "}
              Adding the same address again later restores their access, but
              they will have to verify by email once more.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {revokeError && (
              <p
                role="alert"
                className="rounded-container border border-tone-danger-border bg-tone-danger-surface px-3 py-2 text-sm text-tone-danger-text"
              >
                {revokeError}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRevokeTarget(null);
                setRevokeError(null);
              }}
              disabled={revoking}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokeConfirm}
              disabled={revoking}
            >
              {revoking ? (
                <>
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Removing...
                </>
              ) : (
                "Remove editor"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
