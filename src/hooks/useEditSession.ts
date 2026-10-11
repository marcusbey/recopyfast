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
 * The request body is the caller's, sent as given. The Sites row, its menu
 * and the site header send the user's own grant through
 * `editPermissionsForGrant` (an owner still sends `["edit","admin"]`); the
 * checklist, shown to admins only, sends `["edit","publish"]`. Neither may
 * change here without a story saying so.
 */

export type EditSessionPermission = "view" | "edit" | "publish" | "admin";

/**
 * What an owner's "Edit website" has always sent from a site's own controls
 * (the Sites row, its menu, the site header): their permissions without
 * `view`.
 *
 * It lives here, beside the request it shapes, rather than in the site
 * header's hook: the Sites row imported it from there, which pulled the
 * header, VersionHistoryPanel and SiteProvider into the Sites list for a
 * two-item array (s66c1 review m5).
 */
export const OWNER_EDIT_PERMISSIONS: ["edit", "admin"] = ["edit", "admin"];

/** A member's own row in `site_permissions`, as `GET /api/sites` reports it. */
export type SiteGrant = "view" | "edit" | "publish" | "admin";

/**
 * What a site's own "Edit website" asks for: the user's own grant, never more
 * (PR #72 review, D1).
 *
 * Every site control used to send `OWNER_EDIT_PERMISSIONS` whoever clicked,
 * and `createEditSession` refuses any permission outside the caller's live
 * grant (ADR 047): an `edit` member saw the site, clicked, and was refused,
 * every time. An owner still sends exactly what they always sent; a member
 * sends their own level without `view` (the button's body never carried
 * it); a viewer, or a record that does not say, gets `[]`, which the callers
 * read as "do not offer Edit website". Never a guess upwards: an unknown
 * grant asks for nothing. The server still checks the live row whatever
 * this says, so the value only decides what is worth asking for.
 */
export function editPermissionsForGrant(
  grant: SiteGrant | undefined,
): EditSessionPermission[] {
  switch (grant) {
    case "admin":
      return [...OWNER_EDIT_PERMISSIONS];
    case "publish":
      return ["edit", "publish"];
    case "edit":
      return ["edit"];
    default:
      return [];
  }
}

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
 * The edit link carries a one-time code in its fragment (s76, ADR 055) — not
 * the edit token any more — but it is still opened only if it is an http(s)
 * URL on the site's own registered host: a response that named any other
 * origin would hand that code, and the session behind it, to that origin.
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

/**
 * The validated edit link, moved to one page of the same site (s70b, "Edit on
 * page"). Applied only after `validEditUrl`, and only for a same-origin
 * absolute path: `//evil.example` and `https://…` are origins, not paths, and
 * `/\evil.example` parses to one. The host is checked again on the result, so
 * whatever the path is, the token stays on the registered host. Only the
 * pathname moves; the token's query string is kept.
 */
function atPagePath(editUrl: string, path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return editUrl;
  try {
    const link = new URL(editUrl);
    const resolved = new URL(path, link);
    if (resolved.host !== link.host) return editUrl;
    link.pathname = resolved.pathname;
    return link.toString();
  } catch {
    return editUrl;
  }
}

export function useEditSession(domain: string) {
  const [isOpening, setIsOpening] = useState(false);

  /**
   * Resolves `null` once the tab is on the site, or the message to show when
   * it is not. Call it from the click handler itself.
   *
   * `path` (s70b) opens the session on that page of the site instead of the
   * page the server's link names. It never reaches the request body.
   */
  const openEditSession = useCallback(
    async (
      request: EditSessionRequest,
      path?: string,
    ): Promise<string | null> => {
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

        popup.location.href = atPagePath(editUrl, path);
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
