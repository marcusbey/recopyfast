"use client";

import { useState } from "react";
import { AlertCircle, PencilLine } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  useEditSession,
  type EditSessionPermission,
} from "@/hooks/useEditSession";

/**
 * "Edit website": starts an edit session and opens the site in a new tab.
 *
 * s66c1 rebuilt it on the `Button` primitive. It used to be a raw <button>
 * with its own pill-ish `rounded-lg` classes (the owner's screenshot,
 * 2026-10-08), reached through an "Edit Website" dialog that said one sentence
 * and offered the same button again; it opened the tab after `await`, so
 * pop-up blockers caught it; and it announced success by injecting an emerald
 * `innerHTML` toast into <body>. The dialog and the toast are gone: the new
 * tab is the feedback, and a failure is an inline Alert under the control.
 *
 * The request body is what this button has always sent: the caller's
 * permissions without `view`, for two hours. The Sites row, its menu and the
 * site header pass `["edit","admin"]`; the activation checklist passes
 * `["edit","publish"]`.
 */

const SESSION_HOURS = 2;

interface EditWebsiteButtonProps {
  site: { id: string; domain: string; name: string };
  userPermissions: EditSessionPermission[];
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Overrides the accessible name where several sites share a screen. */
  "aria-label"?: string;
  className?: string;
}

export default function EditWebsiteButton({
  site,
  userPermissions,
  variant = "default",
  size = "default",
  "aria-label": ariaLabel,
  className,
}: EditWebsiteButtonProps) {
  const { openEditSession, isOpening } = useEditSession(site.domain);
  const [error, setError] = useState<string | null>(null);

  // A member without edit or admin cannot start a session; the server would
  // refuse it, so the control does not offer it.
  const canEdit =
    userPermissions.includes("edit") || userPermissions.includes("admin");

  const handleClick = async () => {
    setError(null);
    const message = await openEditSession({
      siteId: site.id,
      permissions: userPermissions.filter(
        (permission) => permission !== "view",
      ),
      durationHours: SESSION_HOURS,
    });
    if (message) setError(message);
  };

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-2", className)}>
      <Button
        variant={variant}
        size={size}
        loading={isOpening}
        disabled={!canEdit}
        aria-label={ariaLabel}
        leftIcon={<PencilLine aria-hidden="true" />}
        onClick={() => void handleClick()}
      >
        Edit website
      </Button>
      {error && (
        <Alert variant="destructive" className="max-w-sm">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
