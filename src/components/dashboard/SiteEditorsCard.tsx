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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Loader2, Lock, Users } from "lucide-react";
import { InviteEditorForm } from "./InviteEditorForm";
import { SiteEditorRow, type SiteEditorSummary } from "./SiteEditorRow";
import type { EditorPermission } from "@/lib/auth/editor-access";

/**
 * Enrolment for `site_editors` — the durable allowlist that decides whose email
 * address may request a sign-in code for this site.
 *
 * This is a different concept from the staging share link next to it. A share
 * writes `staging_access`, which is a time-boxed token for one preview session;
 * an editor is a standing permission that survives devices and sessions. Before
 * this card existed nothing in the product wrote a `site_editors` row at all,
 * so every invited person asked for a code and silently received nothing.
 *
 * The permission vocabulary is the one in `@/lib/auth/editor-access`. Only the
 * type is imported: that module reaches the service-role Supabase client, which
 * must not be pulled into a client bundle, and the widening rule it implements
 * is applied server-side on the way in.
 */

interface SiteEditorsCardProps {
  siteId: string;
  siteName: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; editors: SiteEditorSummary[] };

type Notice =
  | { kind: "invited"; email: string; hubUrl: string }
  | { kind: "removed"; email: string; devicesSignedOut: number };

const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again.";

/** Machine codes the route returns, in the words a site owner can act on. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Your session has expired. Sign in again to manage editors.",
  forbidden: "You need admin permission on this site to manage editors.",
  not_found: "That editor no longer exists.",
  invalid_request: "That request was not valid.",
  invalid_permissions: "Choose at least one permission.",
  server_error: "Something went wrong on our end. Please try again.",
};

/**
 * The route answers with a machine code in `error` and, where there is anything
 * a person can do about it, human text in `message`. Prefer the latter, then a
 * translation of the code, and only then a status-qualified fallback — printing
 * a bare `server_error` at a customer is not an error message.
 */
async function readEditorsError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    const { error, message } = (body ?? {}) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof message === "string" && message) return message;
    if (typeof error === "string" && ERROR_MESSAGES[error]) {
      return ERROR_MESSAGES[error];
    }
  } catch {
    // Non-JSON body — fall through to the status-qualified fallback.
  }
  return `${fallback} (${response.status})`;
}

/**
 * The hub URL is built from our own env var, but it is still a string arriving
 * over the wire, so only http(s) and root-relative forms become a link.
 */
function editorHubHref(hubUrl: string): string | null {
  if (hubUrl.startsWith("/")) return hubUrl;
  try {
    const { protocol } = new URL(hubUrl);
    return protocol === "https:" || protocol === "http:" ? hubUrl : null;
  } catch {
    return null;
  }
}

export function SiteEditorsCard({ siteId, siteName }: SiteEditorsCardProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<SiteEditorSummary | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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

  useEffect(() => {
    loadEditors();
  }, [loadEditors]);

  const handleInvite = useCallback(
    async (
      email: string,
      permissions: EditorPermission[],
    ): Promise<boolean> => {
      setActionError(null);
      setNotice(null);

      try {
        const response = await fetch("/api/editor/editors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId, email, permissions }),
        });

        if (!response.ok) {
          setActionError(
            await readEditorsError(response, "Could not add that editor"),
          );
          return false;
        }

        const data: { editor?: { email?: string }; hubUrl?: string } =
          await response.json();

        setNotice({
          kind: "invited",
          email: data.editor?.email ?? email,
          hubUrl: typeof data.hubUrl === "string" ? data.hubUrl : "",
        });
        await loadEditors();
        return true;
      } catch (error) {
        console.error("Failed to add site editor:", error);
        setActionError(NETWORK_ERROR);
        return false;
      }
    },
    [siteId, loadEditors],
  );

  const openRevokeConfirm = (editor: SiteEditorSummary) => {
    setRevokeError(null);
    setRevokeTarget(editor);
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
      setActionError(null);
      setNotice({
        kind: "removed",
        email: revokeTarget.email,
        devicesSignedOut:
          typeof data.grantsRevoked === "number" ? data.grantsRevoked : 0,
      });
      setRevokeTarget(null);
      await loadEditors();
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
        <CardTitle>Editors</CardTitle>
        <CardDescription>
          People who can edit {siteName} by email, without a ReCopyFast account.
          They sign in at the editor hub with a one-time code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && <NoticePanel notice={notice} />}

        {actionError && (
          <p
            role="alert"
            className="rounded-md border border-tone-danger-border bg-tone-danger-surface px-3 py-2 text-sm text-tone-danger-text"
          >
            {actionError}
          </p>
        )}

        {state.status === "loading" && (
          <div className="space-y-2" role="status" aria-label="Loading editors">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-5 w-32 rounded-full" />
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
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-4">
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
                  "Add their email address below.",
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
                    />
                  ))}
                </ul>
              </div>
            )}

            <InviteEditorForm onInvite={handleInvite} />
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

          {revokeError && (
            <p
              role="alert"
              className="rounded-md border border-tone-danger-border bg-tone-danger-surface px-3 py-2 text-sm text-tone-danger-text"
            >
              {revokeError}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
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

/**
 * Enrolment sends no mail. Saying so is the point of this panel: the owner
 * otherwise assumes an invitation went out, and the editor's silence looks
 * like a broken inbox rather than a step nobody has taken yet.
 */
function NoticePanel({ notice }: { notice: Notice }) {
  if (notice.kind === "removed") {
    const { devicesSignedOut } = notice;
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-tone-success-border bg-tone-success-surface px-3 py-2 text-sm text-tone-success-text"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Removed {notice.email}.{" "}
          {devicesSignedOut === 0
            ? "They had no signed-in devices."
            : `${devicesSignedOut} device ${
                devicesSignedOut === 1 ? "session" : "sessions"
              } signed out.`}
        </span>
      </p>
    );
  }

  const href = editorHubHref(notice.hubUrl);

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-tone-success-border bg-tone-success-surface px-3 py-2 text-sm text-tone-success-text"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{notice.email} can now edit this site.</p>
        <p>
          No invitation email is sent. Ask them to open{" "}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              the editor hub
            </a>
          ) : (
            <span className="font-medium">the editor hub</span>
          )}{" "}
          and request a sign-in code.
        </p>
      </div>
    </div>
  );
}
