"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Changes page's server state (s70b): one `GET /api/content/changes` per
 * filter, 50 rows at a time.
 *
 * The page this replaces waited on GET /api/sites and then downloaded every
 * row of every site to filter in the browser. Here the server filters, counts
 * and pages (ADR 054); this hook only asks, appends and keeps answers in
 * order. Three rules it owns:
 * - a filter change starts again at offset 0, and an answer to an older
 *   filter that arrives late is dropped, never drawn over the new one;
 * - "Show 50 more" appends and drops a row it already holds (the server pages
 *   by `changed_at`, so a row that changed between two reads can come back);
 * - a refused read is an error, never an empty list (`useSites.ts`): an empty
 *   list tells an owner "nothing changed" when the truth is "we failed";
 * - a reload empties the rows, never the frame around them: `sites` and
 *   `counts` keep the last answer's values until the next one lands.
 *   Tombstone (s70b review M1): `load()` once emptied everything, and the
 *   filter bar draws its site select and status counts from the answer, so
 *   picking a site unmounted the select under the owner's hand (focus lost)
 *   and every search blanked the counts.
 */

export type ChangeState = "pending" | "published" | "original";
export type ChangesStateFilter = "changes" | "pending" | "published" | "all";
export type SiteGrant = "view" | "edit" | "publish" | "admin";

export interface ChangesSite {
  id: string;
  name: string;
  domain: string;
  permission: SiteGrant | string;
}

export interface ContentChange {
  id: string;
  siteId: string;
  elementId: string;
  pagePath: string | null;
  elementType: string | null;
  selector: string | null;
  language: string;
  variant: string;
  original: string | null;
  live: string | null;
  draft: string | null;
  state: ChangeState;
  changedAt: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface ChangesCounts {
  pending: number;
  published: number;
  original: number;
}

export interface ChangesPage {
  sites: ChangesSite[];
  rows: ContentChange[];
  total: number;
  counts: ChangesCounts;
  nextOffset: number | null;
}

export interface ChangesFilters {
  site: string | null;
  state: ChangesStateFilter;
  q: string;
}

/** Typing "pricing" asks once, not seven times. */
export const SEARCH_DEBOUNCE_MS = 250;
const FALLBACK_ERROR = "Failed to load changes";

function isChangesPage(body: unknown): body is ChangesPage {
  const candidate = body as Partial<ChangesPage> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray(candidate.rows) &&
    Array.isArray(candidate.sites) &&
    typeof candidate.counts === "object" &&
    candidate.counts !== null
  );
}

async function fetchChanges(
  filters: ChangesFilters,
  offset: number,
): Promise<ChangesPage> {
  const params = new URLSearchParams({
    state: filters.state,
    offset: String(offset),
  });
  if (filters.site) params.set("site", filters.site);
  if (filters.q) params.set("q", filters.q);

  const response = await fetch(`/api/content/changes?${params.toString()}`);
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
  if (!isChangesPage(body)) {
    throw new Error(`${FALLBACK_ERROR}: unexpected response`);
  }
  return body;
}

function appendPage(previous: ChangesPage, next: ChangesPage): ChangesPage {
  const known = new Set(previous.rows.map((row) => row.id));
  return {
    ...next,
    rows: [...previous.rows, ...next.rows.filter((row) => !known.has(row.id))],
  };
}

function moveCount(
  counts: ChangesCounts,
  from: ChangeState,
  to: ChangeState,
): ChangesCounts {
  if (from === to) return counts;
  return {
    ...counts,
    [from]: Math.max(0, counts[from] - 1),
    [to]: counts[to] + 1,
  };
}

/** What the filter bar draws from an answer: it outlives a reload. */
type Frame = Pick<ChangesPage, "sites" | "counts">;

interface Held {
  /** The list on screen; null while a first page loads, and after it failed. */
  data: ChangesPage | null;
  /** The last answer's frame, held only while `data` is null. */
  frame: Frame | null;
}

const frameOf = (page: ChangesPage): Frame => ({
  sites: page.sites,
  counts: page.counts,
});

export function useContentChanges({ site, state, q }: ChangesFilters) {
  const query = q.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [held, setHeld] = useState<Held>({ data: null, frame: null });
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by every first-page read; an answer from an older one is dropped. */
  const generation = useRef(0);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    generation.current += 1;
    const current = generation.current;
    setLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setHeld((previous) => ({
      data: null,
      frame: previous.data ? frameOf(previous.data) : previous.frame,
    }));
    try {
      const page = await fetchChanges({ site, state, q: debouncedQuery }, 0);
      if (current !== generation.current) return;
      setHeld({ data: page, frame: null });
    } catch (caught) {
      if (current !== generation.current) return;
      setError(caught instanceof Error ? caught.message : FALLBACK_ERROR);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [site, state, debouncedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = held.data;
  const loadMore = useCallback(async () => {
    if (!data || data.nextOffset === null || isLoadingMore) return;
    const current = generation.current;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await fetchChanges(
        { site, state, q: debouncedQuery },
        data.nextOffset,
      );
      if (current !== generation.current) return;
      setHeld((previous) => ({
        ...previous,
        data: previous.data ? appendPage(previous.data, page) : page,
      }));
    } catch (caught) {
      if (current !== generation.current) return;
      setError(caught instanceof Error ? caught.message : FALLBACK_ERROR);
    } finally {
      if (current === generation.current) setIsLoadingMore(false);
    }
  }, [data, isLoadingMore, site, state, debouncedQuery]);

  /**
   * A row action succeeded: the row changes in place (design: "success in
   * place"), and the status counts follow it. The row stays where it is even
   * if it no longer matches the filter, so the owner sees what they did.
   */
  const updateRow = useCallback(
    (rowId: string, patch: Partial<ContentChange>) => {
      setHeld((previous) => {
        const current = previous.data;
        if (!current) return previous;
        const before = current.rows.find((row) => row.id === rowId);
        if (!before) return previous;
        const after = { ...before, ...patch };
        return {
          ...previous,
          data: {
            ...current,
            rows: current.rows.map((row) => (row.id === rowId ? after : row)),
            counts: moveCount(current.counts, before.state, after.state),
          },
        };
      });
    },
    [],
  );

  const frame = data ? frameOf(data) : held.frame;

  return {
    /** The rows' page: null while a first page loads, and after it failed. */
    data,
    /** The caller's sites, kept while the list reloads; null before the first answer. */
    sites: frame?.sites ?? null,
    /** The status counts, kept while the list reloads; null before the first answer. */
    counts: frame?.counts ?? null,
    loading,
    error,
    refetch: load,
    loadMore,
    isLoadingMore,
    updateRow,
    /** The search the data was read with (typing waits for the debounce). */
    appliedQuery: debouncedQuery,
  };
}
