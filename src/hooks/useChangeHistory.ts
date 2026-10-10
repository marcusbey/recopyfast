"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One row's draft and publish trail, read on its first expand (s70b).
 *
 * Kept for the page's lifetime (design, Performance): collapsing a row and
 * opening it again, or opening another row and coming back, asks the server
 * nothing. The cache key carries the row's `changedAt`, so a row whose change
 * moved on — a revert or a publish from this page — is read again rather
 * than shown its old trail. A refused read is an error and is never cached.
 */

export interface ChangeHistoryEvent {
  id: string;
  action: string | null;
  /** An address, or null when the writer left none (import, API, A/B). */
  by: string | null;
  at: string;
  previous: string | null;
  content: string | null;
}

export interface ChangeHistory {
  /** False for anyone but a site admin: history is admin-only by RLS. */
  historyVisible: boolean;
  discoveredAt: string;
  events: ChangeHistoryEvent[];
}

const FALLBACK_ERROR = "Failed to load history";

/** Module scope, so a remounted row (collapsed, then expanded) reuses it. */
const cache = new Map<string, ChangeHistory>();

/**
 * Forgets every cached trail. AuthContext calls it on SIGNED_OUT.
 *
 * Tombstone (s70b review m6): module scope outlives a client-side sign-out
 * (`signOut()` is a `router.push`, not a page load), and a trail carries who
 * changed what, which only a site admin may read. Without this, the next
 * account signed in on the same tab was served the last one's trails.
 */
export function clearChangeHistory(): void {
  cache.clear();
}

const cacheKey = (rowId: string, version: string | null) =>
  `${rowId}@${version ?? ""}`;

function isChangeHistory(body: unknown): body is ChangeHistory {
  const candidate = body as Partial<ChangeHistory> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.historyVisible === "boolean" &&
    Array.isArray(candidate.events)
  );
}

async function fetchHistory(rowId: string): Promise<ChangeHistory> {
  const response = await fetch(
    `/api/content/changes/${encodeURIComponent(rowId)}/history`,
  );
  if (!response.ok) {
    let message = `${FALLBACK_ERROR} (${response.status})`;
    try {
      const body: unknown = await response.json();
      const serverMessage = (body as { error?: unknown } | null)?.error;
      if (typeof serverMessage === "string" && serverMessage) {
        message = serverMessage;
      }
    } catch {
      // Not JSON: keep the status-qualified message.
    }
    throw new Error(message);
  }
  const body: unknown = await response.json();
  if (!isChangeHistory(body)) {
    throw new Error(`${FALLBACK_ERROR}: unexpected response`);
  }
  return body;
}

/**
 * @param rowId the open row, or null while none is open (nothing is read).
 * @param version the row's `changedAt`: a new value is a new trail.
 */
export function useChangeHistory(rowId: string | null, version: string | null) {
  const key = rowId ? cacheKey(rowId, version) : null;
  const [entry, setEntry] = useState<{
    key: string | null;
    data: ChangeHistory | null;
    error: string | null;
  }>(() => ({
    key,
    data: key ? (cache.get(key) ?? null) : null,
    error: null,
  }));
  const [isFetching, setIsFetching] = useState(false);
  /** The key on screen; an answer for any other key is cached, not drawn. */
  const currentKey = useRef(key);
  useEffect(() => {
    currentKey.current = key;
  }, [key]);

  const load = useCallback(async () => {
    if (!rowId || !key) return;
    setIsFetching(true);
    setEntry({ key, data: null, error: null });
    try {
      const history = await fetchHistory(rowId);
      cache.set(key, history);
      if (currentKey.current === key) {
        setEntry({ key, data: history, error: null });
      }
    } catch (caught) {
      if (currentKey.current === key) {
        setEntry({
          key,
          data: null,
          error: caught instanceof Error ? caught.message : FALLBACK_ERROR,
        });
      }
    } finally {
      if (currentKey.current === key) setIsFetching(false);
    }
  }, [rowId, key]);

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key);
    if (cached) {
      setEntry({ key, data: cached, error: null });
      return;
    }
    void load();
  }, [key, load]);

  // Derived for the key being shown, so a row switch never shows the last
  // row's trail for a frame.
  const isCurrent = entry.key === key;
  const cached = key ? (cache.get(key) ?? null) : null;
  const data = isCurrent ? (entry.data ?? cached) : cached;
  const error = isCurrent ? entry.error : null;

  return {
    data,
    loading: Boolean(key) && !data && !error && (isFetching || !isCurrent),
    error,
    refetch: load,
  };
}
