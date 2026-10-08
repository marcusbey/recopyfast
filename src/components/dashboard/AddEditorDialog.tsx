"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EditorPermission } from "@/lib/auth/editor-access";
import { InviteEditorForm } from "./InviteEditorForm";

/**
 * "Add editor": enrolment for `site_editors`, the durable allowlist that
 * decides whose email address may request a sign-in code for this site
 * (s66c1 AC 6).
 *
 * One dialog for every caller. Until s66c1 the same enrolment had three
 * labels and two identical forms: "Add editor" under the Editors list,
 * "Invite a client" (that whole card again, in a dialog from the activation
 * checklist), and a share link's look-alike permission toggles. People &
 * access and the checklist now open this, under one name. The checklist
 * passes its View+Edit+Publish preset (s35); everyone else gets View+Edit.
 *
 * This is a different concept from a preview link. A share writes
 * `staging_access`, a time-boxed token for one review; an editor is a
 * standing permission that survives devices and sessions. Before the
 * Editors card existed nothing in the product wrote a `site_editors` row at
 * all, so every invited person asked for a code and silently received
 * nothing.
 *
 * The permission vocabulary is the one in `@/lib/auth/editor-access`. Only the
 * type is imported: that module reaches the service-role Supabase client, which
 * must not be pulled into a client bundle, and the widening rule it implements
 * is applied server-side on the way in.
 */

export const ADD_EDITOR_EXPLAINER =
  "For someone who keeps editing this site. They sign in with a code sent to their email and keep access until you remove them.";

export const NETWORK_ERROR =
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
 * A refused action, and whether the remedy is billing rather than retrying.
 *
 * `upgradeRequired` is what separates "this went wrong" from "you have spent
 * what you bought". Showing the second as a red error would be a lie about
 * whose fault it is and would leave the owner retrying a button that is working
 * exactly as intended.
 */
export interface ActionFailure {
  message: string;
  upgradeRequired: boolean;
}

/**
 * The route answers with a machine code in `error` and, where there is anything
 * a person can do about it, human text in `message`. Prefer the latter, then a
 * translation of the code, and only then a status-qualified fallback — printing
 * a bare `server_error` at a customer is not an error message.
 */
export async function readActionFailure(
  response: Response,
  fallback: string,
): Promise<ActionFailure> {
  try {
    const body: unknown = await response.json();
    const { error, message, upgradeRequired } = (body ?? {}) as {
      error?: unknown;
      message?: unknown;
      upgradeRequired?: unknown;
    };

    const text =
      typeof message === "string" && message
        ? message
        : typeof error === "string" && ERROR_MESSAGES[error]
          ? ERROR_MESSAGES[error]
          : `${fallback} (${response.status})`;

    return { message: text, upgradeRequired: upgradeRequired === true };
  } catch {
    // Non-JSON body — fall through to the status-qualified fallback.
    return {
      message: `${fallback} (${response.status})`,
      upgradeRequired: false,
    };
  }
}

export type EditorNotice =
  | {
      kind: "invited";
      email: string;
      hubUrl: string;
      invitationEmailSent: boolean;
      action: "invite" | "resend";
    }
  | { kind: "removed"; email: string; devicesSignedOut: number };

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

const NOTICE_CLASSES =
  "flex items-start gap-2 rounded-container border border-tone-success-border bg-tone-success-surface px-3 py-2 text-sm text-tone-success-text";

/**
 * Delivery confirmation or the manual handoff that keeps a mail outage soft.
 * The Editors list shows it too, for a resend or a removal.
 */
export function EditorNoticePanel({ notice }: { notice: EditorNotice }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  if (notice.kind === "removed") {
    const { devicesSignedOut } = notice;
    return (
      <p role="status" className={NOTICE_CLASSES}>
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

  const copyHubLink = async () => {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div role="status" className={NOTICE_CLASSES}>
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {notice.invitationEmailSent ? (
          <p>We emailed {notice.email} an invitation.</p>
        ) : (
          <>
            <p>
              {notice.action === "resend"
                ? `We could not resend the invitation email to ${notice.email}. They still have access.`
                : `${notice.email} can now edit this site.`}
            </p>
            <p>
              No invitation email was sent. Ask them to open{" "}
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
            {href && (
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={copyHubLink}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Copy link
                </Button>
                {copyState === "copied" && <span>Link copied.</span>}
                {copyState === "failed" && (
                  <span role="alert">Could not copy link.</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface AddEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  siteName: string;
  /** The checklist's preset (View+Edit+Publish); View+Edit otherwise. */
  defaultPermissions?: readonly EditorPermission[];
  /** An editor now exists: callers refetch whatever counts editors. */
  onAdded?: () => void;
  /** Where focus goes when the dialog closes, for callers that move it. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function AddEditorDialog({
  open,
  onOpenChange,
  siteId,
  siteName,
  defaultPermissions,
  onAdded,
  onCloseAutoFocus,
}: AddEditorDialogProps) {
  const [notice, setNotice] = useState<EditorNotice | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts on an empty form. The notice must survive everything
  // while the dialog is open (the checklist completes, or its refresh fails,
  // behind it), so it is cleared on the next opening, not on a re-render.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNotice(null);
      setFailure(null);
    }
  }

  const handleInvite = async (
    email: string,
    permissions: EditorPermission[],
  ): Promise<boolean> => {
    setFailure(null);
    setNotice(null);

    try {
      const response = await fetch("/api/editor/editors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, email, permissions }),
      });

      if (!response.ok) {
        setFailure(
          await readActionFailure(response, "Could not add that editor"),
        );
        return false;
      }

      const data: {
        editor?: { email?: string };
        hubUrl?: string;
        invitationEmailSent?: boolean;
      } = await response.json();

      setNotice({
        kind: "invited",
        email: data.editor?.email ?? email,
        hubUrl: typeof data.hubUrl === "string" ? data.hubUrl : "",
        invitationEmailSent: data.invitationEmailSent === true,
        action: "invite",
      });
      onAdded?.();
      return true;
    } catch (error) {
      console.error("Failed to add site editor:", error);
      setFailure({ message: NETWORK_ERROR, upgradeRequired: false });
      return false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          {/* The site is named for screen readers: the dialog opens from a
              checklist that can list several sites. */}
          <DialogTitle>
            Add editor<span className="sr-only"> to {siteName}</span>
          </DialogTitle>
          <DialogDescription>{ADD_EDITOR_EXPLAINER}</DialogDescription>
        </DialogHeader>

        {notice ? (
          <>
            <DialogBody>
              <EditorNoticePanel notice={notice} />
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <InviteEditorForm
            onInvite={handleInvite}
            autoFocus
            initialPermissions={defaultPermissions}
          >
            {({ fields, canSubmit, isSubmitting }) => (
              <>
                <DialogBody>
                  {failure &&
                    (failure.upgradeRequired ? (
                      // A seat limit is not a malfunction. It gets the warning
                      // tone and a route to the thing that actually resolves
                      // it, rather than a red box inviting the owner to press
                      // the button again.
                      <div
                        role="alert"
                        className="flex flex-col gap-2 rounded-container border border-tone-warning-border bg-tone-warning-surface px-3 py-2 text-sm text-tone-warning-text"
                      >
                        <p>{failure.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start"
                          asChild
                        >
                          <Link href="/dashboard/billing">View plans</Link>
                        </Button>
                      </div>
                    ) : (
                      <p
                        role="alert"
                        className="rounded-container border border-tone-danger-border bg-tone-danger-surface px-3 py-2 text-sm text-tone-danger-text"
                      >
                        {failure.message}
                      </p>
                    ))}
                  {fields}
                </DialogBody>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden="true" />
                        Adding editor…
                      </>
                    ) : (
                      <>
                        <UserPlus aria-hidden="true" />
                        Add editor
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}
          </InviteEditorForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
