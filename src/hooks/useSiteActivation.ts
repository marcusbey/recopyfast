"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SiteActivationProgress {
  installed: boolean;
  invited: boolean;
  published: boolean;
  dismissed: boolean;
}

interface UseSiteActivationOptions {
  siteId: string;
  userId: string;
}

const REFRESH_INTERVAL_MS = 15_000;

function isProgress(value: unknown): value is SiteActivationProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["installed", "invited", "published", "dismissed"].every(
    (key) => typeof candidate[key] === "boolean",
  );
}

export function useSiteActivation({
  siteId,
  userId,
}: UseSiteActivationOptions) {
  const [data, setData] = useState<SiteActivationProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const identity = `${userId}:${siteId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const dataIdentityRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const requestIdentity = `${userId}:${siteId}`;
    const requestNumber = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sites/${siteId}/activation`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isProgress(body)) {
        throw new Error("Could not load activation progress");
      }

      if (
        identityRef.current !== requestIdentity ||
        requestRef.current !== requestNumber
      ) {
        return;
      }
      dataIdentityRef.current = requestIdentity;
      setData(body);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (
        identityRef.current !== requestIdentity ||
        requestRef.current !== requestNumber
      ) {
        return;
      }
      console.error("Failed to load site activation progress:", caught);
      dataIdentityRef.current = null;
      setData(null);
      setError("Could not load activation progress");
    } finally {
      if (
        identityRef.current === requestIdentity &&
        requestRef.current === requestNumber
      ) {
        setLoading(false);
      }
    }
  }, [siteId, userId]);

  useEffect(() => {
    setData(null);
    dataIdentityRef.current = null;
    setError(null);
    setDismissError(null);
    setDismissing(false);
    void refresh();
    return () => abortRef.current?.abort();
  }, [identity, refresh]);

  const visibleData = dataIdentityRef.current === identity ? data : null;
  const incomplete =
    visibleData !== null &&
    !(visibleData.installed && visibleData.invited && visibleData.published);

  useEffect(() => {
    if (!incomplete || visibleData?.dismissed) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(
      refreshWhenVisible,
      REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [visibleData?.dismissed, incomplete, refresh]);

  const dismiss = useCallback(async () => {
    const requestIdentity = `${userId}:${siteId}`;
    setDismissing(true);
    setDismissError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/activation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error("Could not save dismissal");
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        (body as { dismissed?: unknown }).dismissed !== true
      ) {
        throw new Error("Could not save dismissal");
      }
      if (identityRef.current !== requestIdentity) return;
      // A GET issued before this write can still resolve with dismissed:false.
      // Retire it before changing local state so server-confirmed dismissal
      // cannot be undone by an older response from the same identity.
      ++requestRef.current;
      abortRef.current?.abort();
      dataIdentityRef.current = requestIdentity;
      setData((current) =>
        current ? { ...current, dismissed: true } : current,
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save dismissal";
      if (identityRef.current === requestIdentity) setDismissError(message);
      throw new Error(message);
    } finally {
      if (identityRef.current === requestIdentity) setDismissing(false);
    }
  }, [siteId, userId]);

  return {
    data: visibleData,
    loading,
    error,
    refresh,
    dismiss,
    dismissing,
    dismissError,
  };
}
