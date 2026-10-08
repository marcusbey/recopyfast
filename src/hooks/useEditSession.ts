"use client";

import { useCallback, useState } from "react";

/**
 * Starts an owner's edit session and opens the site in a new tab (s66c1
 * AC 4).
 *
 * Extracted from the activation checklist, which had the only correct copy:
 * the old `EditWebsiteButton` opened the tab after `await` (so pop-up blockers
 * caught it), accepted any `editUrl` the response carried, and fell back to a
 * URL it built itself. Every "Edit website" control now goes through here.
 *
 * The request body is the caller's, sent as given. Two bodies exist and both
 * are deliberate: the Sites row, its menu and the site header send what an
 * owner's button always sent (`["edit","admin"]`), the checklist sends
 * `["edit","publish"]`. Neither may change here without a story saying so.
 */

export type EditSessionPermission = "view" | "edit" | "publish" | "admin";

export interface EditSessionRequest {
  siteId: string;
  permissions: readonly EditSessionPermission[];
  durationHours: number;
}

export const POPUP_BLOCKED_MESSAGE =
  "Allow pop-ups for ReCopyFast, then try again.";
const REFUSED_FALLBACK = "Could not open edit mode";
const INVALID_LINK = "The server did not return a valid edit link.";

function registeredHostname(domain: string): string | null {
  try {
    return new URL(domain.includes("://") ? domain : `https://${domain}`)
      .hostname;
  } catch {
    return null;
  }
}

/**
 * The edit link carries a short-lived edit token, so it is opened only if it
 * is an http(s) URL on the site's own registered host: a response that named
 * any other origin would hand that token to it.
 */
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

export function useEditSession(domain: string) {
  const [isOpening, setIsOpening] = useState(false);

  /**
   * Resolves `null` once the tab is on the site, or the message to show when
   * it is not. Call it from the click handler itself.
   */
  const openEditSession = useCallback(
    async (request: EditSessionRequest): Promise<string | null> => {
      // Browsers associate pop-up permission with the synchronous click.
      // Opening only after the network round trip loses that activation and
      // turns a healthy edit-session response into a blocked pop-up.
      const popup = window.open("about:blank", "_blank");
      if (!popup) return POPUP_BLOCKED_MESSAGE;
      popup.opener = null;
      setIsOpening(true);

      try {
        const response = await fetch("/api/edit-sessions/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const body: { editUrl?: unknown; error?: unknown } =
          await response.json();
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : REFUSED_FALLBACK,
          );
        }
        const editUrl = validEditUrl(body.editUrl, domain);
        if (!editUrl) throw new Error(INVALID_LINK);

        popup.location.href = editUrl;
        return null;
      } catch (caught) {
        popup.close();
        return caught instanceof Error ? caught.message : REFUSED_FALLBACK;
      } finally {
        setIsOpening(false);
      }
    },
    [domain],
  );

  return { openEditSession, isOpening };
}
