"use client";

import { PencilLine } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
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
 * tab is the feedback.
 *
 * A failure is handed to the caller through `onErrorChange`, never drawn
 * here. The button used to render its own Alert under itself, and every
 * caller puts it in a row of controls: in the site header that put the
 * message inside the actions row (at 1280 it pushed the site's name down and
 * knocked "Version history" out of line, at 375 it sat between the two
 * buttons), on a Sites row inside the action cell, in the checklist inside
 * the step. Each caller now shows it where a message belongs: the site pages
 * as their first section, the Sites row on its own message line, the
 * checklist above its steps (s66c1 pre-PR fix). The pending state stays on
 * the button. `onErrorChange` is required so that no caller can drop a
 * refusal on the floor.
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
  /**
   * `null` as an attempt starts, then the message if it fails. Where the
   * message renders is the caller's decision, and never beside the button.
   */
  onErrorChange: (message: string | null) => void;
  /** Overrides the accessible name where several sites share a screen. */
  "aria-label"?: string;
  className?: string;
}

export default function EditWebsiteButton({
  site,
  userPermissions,
  onErrorChange,
  variant = "default",
  size = "default",
  "aria-label": ariaLabel,
  className,
}: EditWebsiteButtonProps) {
  const { openEditSession, isOpening } = useEditSession(site.domain);

  // A member without edit or admin cannot start a session; the server would
  // refuse it, so the control does not offer it.
  const canEdit =
    userPermissions.includes("edit") || userPermissions.includes("admin");

  const handleClick = async () => {
    onErrorChange(null);
    const message = await openEditSession({
      siteId: site.id,
      permissions: userPermissions.filter(
        (permission) => permission !== "view",
      ),
      durationHours: SESSION_HOURS,
    });
    if (message) onErrorChange(message);
  };

  return (
    <Button
      variant={variant}
      size={size}
      loading={isOpening}
      disabled={!canEdit}
      aria-label={ariaLabel}
      leftIcon={<PencilLine aria-hidden="true" />}
      className={className}
      onClick={() => void handleClick()}
    >
      Edit website
    </Button>
  );
}
