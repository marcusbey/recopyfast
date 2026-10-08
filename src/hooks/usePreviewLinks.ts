"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ShareLink } from "@/components/dashboard/ShareLinkCard";

/**
 * A site's preview links (`staging_access`): the list, and revoking one
 * (s66c1 AC 6).
 *
 * Both calls moved out of the Share dialog, which fetched the list on every
 * open and revoked with a `catch` that only logged: a refused revoke left the
 * row on screen and nothing said the link still worked. The dialog is
 * create-only now, and People & access lists the links through this.
 *
 * Server state as AGENTS.md § React has it: a non-ok response is an error,
 * never an empty list. A 403 is not a failure, though: a member who is not an
 * admin of this site reaches People & access legitimately and simply cannot
 * manage links, so it is reported apart (`isForbidden`) and offers no retry.
 */

export interface PreviewLinksError {
  message: string;
  isForbidden: boolean;
}

const LOAD_FAILED = "Could not load preview links";
const NETWORK_ERROR =
  "Could not reach the server. Check your connection and try again.";

async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === "string" && error) return error;
  } catch {
    // Non-JSON body: the status-qualified fallback below.
  }
  return `${fallback} (${response.status})`;
}

export function usePreviewLinks(siteId: string) {
  const [data, setData] = useState<ShareLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PreviewLinksError | null>(null);
  const requestRef = useRef(0);

  const refetch = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/staging/access?siteId=${encodeURIComponent(siteId)}`,
      );
      if (!response.ok) {
        const message = await readError(response, LOAD_FAILED);
        if (request !== requestRef.current) return;
        setData(null);
        setError({ message, isForbidden: response.status === 403 });
        return;
      }
      const body: { accessList?: ShareLink[] } = await response.json();
      if (request !== requestRef.current) return;
      setData(body.accessList ?? []);
    } catch (caught) {
      if (request !== requestRef.current) return;
      console.error("Failed to load preview links:", caught);
      setData(null);
      setError({ message: NETWORK_ERROR, isForbidden: false });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void refetch();
    return () => {
      requestRef.current += 1;
    };
  }, [refetch]);

  /** Resolves `null` once the link is revoked, or why it was not. */
  const revoke = useCallback(
    async (link: ShareLink): Promise<string | null> => {
      try {
        const response = await fetch(
          `/api/staging/access?accessId=${encodeURIComponent(link.id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          return await readError(response, "Could not revoke that link");
        }
        setData((current) =>
          current ? current.filter((entry) => entry.id !== link.id) : current,
        );
        return null;
      } catch (caught) {
        console.error("Failed to revoke a preview link:", caught);
        return NETWORK_ERROR;
      }
    },
    [],
  );

  return { data, loading, error, refetch, revoke };
}
