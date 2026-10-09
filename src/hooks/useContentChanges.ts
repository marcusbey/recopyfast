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
 *   and every search blanked the counts;
 * - after a write, the server is read again (`refreshAfterWrite`): every row
 *   of the written element, every language and variant, and the counts. The
 *   page never derives what a write left behind. Tombstone (s70b fix pass,
 *   C1): the row was redrawn "in place" from what the action meant to do,
 *   but Publish promotes every language and variant row of an element_id
 *   (20260924060000), so an fr sibling kept showing its old draft, and its
 *   Discard re-staged the old text and link for the next Publish to put back;
 * - reads are numbered as they start, and a row is only ever replaced by a
 *   copy from a read that started later. Tombstone (review m1): a filter
 *   changed while Publish was in flight emptied the list, the in-place patch
 *   found no row and was dropped, and the reload, read before the publish
 *   committed, drew the row as Pending with Discard offered.
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

/** An attribute a draft stages (a link's `href`, an image's `alt`). */
export interface DraftAttribute {
  name: string;
  /** Its value live now; null when the live element has none. */
  live: string | null;
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
  /**
   * The attributes a pending row's draft stages; empty for any other row.
   * Null when they are not known (the route could not read them, or the
   * answer carried no valid list): such a draft is never offered a discard.
   */
  draftAttributes: DraftAttribute[] | null;
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

function isDraftAttribute(value: unknown): value is DraftAttribute {
  const candidate = value as Partial<DraftAttribute> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.name === "string" &&
    (candidate.live === null || typeof candidate.live === "string")
  );
}

/**
 * A row's staged attributes as the page may trust them: a valid list, or null
 * ("not known"), never a guess. Tombstone (Devin re-review N4): a row without
 * the field reached `discardAttributes` as `undefined` and threw "not
 * iterable" while the row was drawn. Defaulting it to `[]` would have been
 * worse: "stages nothing" offers a Discard that leaves a staged link staged.
 */
function knownAttributes(value: unknown): DraftAttribute[] | null {
  return Array.isArray(value) && value.every(isDraftAttribute) ? value : null;
}

/** A list read: the page's filters, or one element of one site. */
interface ChangesRead extends ChangesFilters {
  element?: string;
}

async function fetchChanges(
  filters: ChangesRead,
  offset: number,
): Promise<ChangesPage> {
  const params = new URLSearchParams({
    state: filters.state,
    offset: String(offset),
  });
  if (filters.site) params.set("site", filters.site);
  if (filters.element) params.set("element", filters.element);
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
  return {
    ...body,
    rows: body.rows.map((row) => ({
      ...row,
      draftAttributes: knownAttributes(row.draftAttributes),
    })),
  };
}

/**
 * Every row of one element on one site, every language and variant, as the
 * server holds them now (`?site&element&state=all`). An element has one row
 * per language × variant, far fewer than the route's 50-row page.
 */
export async function readElementChanges(
  siteId: string,
  elementId: string,
): Promise<ContentChange[]> {
  const page = await fetchChanges(
    { site: siteId, element: elementId, state: "all", q: "" },
    0,
  );
  return page.rows;
}

/** What the filter bar draws from an answer: it outlives a reload. */
type Frame = Pick<ChangesPage, "sites" | "counts">;

/** A row as one numbered read returned it. */
interface ReadRow {
  read: number;
  row: ContentChange;
}

interface Held {
  /** The list on screen; null while a first page loads, and after it failed. */
  data: ChangesPage | null;
  /** The last answer's frame, held only while `data` is null. */
  frame: Frame | null;
  /** The read each row on screen came from. */
  rowReads: ReadonlyMap<string, number>;
  /** The read `data`'s sites, counts and total came from. */
  frameRead: number;
}

const EMPTY: Held = {
  data: null,
  frame: null,
  rowReads: new Map(),
  frameRead: 0,
};

const frameOf = (page: ChangesPage): Frame => ({
  sites: page.sites,
  counts: page.counts,
});

/**
 * The rows of an answer from read `read`, each replaced by its copy from a
 * re-read after a write that started later, if there is one: a list read
 * that left before the write never draws a row the write changed as it was.
 */
function takeRows(
  rows: ContentChange[],
  read: number,
  rereads: ReadonlyMap<string, ReadRow>,
  rowReads: Map<string, number>,
): ContentChange[] {
  return rows.map((row) => {
    const reread = rereads.get(row.id);
    const newest = reread && reread.read > read ? reread : { read, row };
    rowReads.set(row.id, newest.read);
    return newest.row;
  });
}

function firstPage(
  page: ChangesPage,
  read: number,
  rereads: ReadonlyMap<string, ReadRow>,
): Held {
  const rowReads = new Map<string, number>();
  return {
    data: { ...page, rows: takeRows(page.rows, read, rereads, rowReads) },
    frame: null,
    rowReads,
    frameRead: read,
  };
}

/**
 * "Show 50 more": the new rows are appended, a row already held is dropped
 * (the server pages by `changed_at`, so a row can come back), and the frame
 * is taken only if this read started after the one it came from.
 */
function appendPage(
  previous: Held,
  next: ChangesPage,
  read: number,
  rereads: ReadonlyMap<string, ReadRow>,
): Held {
  const current = previous.data;
  if (!current) return firstPage(next, read, rereads);
  const known = new Set(current.rows.map((row) => row.id));
  const rowReads = new Map(previous.rowReads);
  const added = takeRows(
    next.rows.filter((row) => !known.has(row.id)),
    read,
    rereads,
    rowReads,
  );
  const isNewerFrame = read > previous.frameRead;
  const frameSource = isNewerFrame ? next : current;
  return {
    ...previous,
    data: {
      sites: frameSource.sites,
      counts: frameSource.counts,
      total: frameSource.total,
      rows: [...current.rows, ...added],
      nextOffset: next.nextOffset,
    },
    rowReads,
    frameRead: isNewerFrame ? read : previous.frameRead,
  };
}

/** Rows re-read after a write replace their copies on screen, if older. */
function patchRows(previous: Held, rows: ContentChange[], read: number): Held {
  const current = previous.data;
  if (!current) return previous;
  const fresh = new Map(rows.map((row) => [row.id, row]));
  const rowReads = new Map(previous.rowReads);
  let isChanged = false;
  const patched = current.rows.map((row) => {
    const copy = fresh.get(row.id);
    if (!copy || (rowReads.get(row.id) ?? 0) >= read) return row;
    rowReads.set(row.id, read);
    isChanged = true;
    return copy;
  });
  return isChanged
    ? { ...previous, data: { ...current, rows: patched }, rowReads }
    : previous;
}

/** A fresh first page's frame and total, if it is newer than the shown one. */
function patchFrame(previous: Held, page: ChangesPage, read: number): Held {
  const current = previous.data;
  if (!current || read <= previous.frameRead) return previous;
  return {
    ...previous,
    data: {
      ...current,
      sites: page.sites,
      counts: page.counts,
      total: page.total,
    },
    frameRead: read,
  };
}

export function useContentChanges({ site, state, q }: ChangesFilters) {
  const query = q.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [held, setHeld] = useState<Held>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by every first-page read; an answer from an older one is dropped. */
  const generation = useRef(0);
  /** Numbers every read as it starts: a later-started read's row wins. */
  const reads = useRef(0);
  /** The filters of the newest first-page read, for a re-read after a write. */
  const active = useRef<{ generation: number; filters: ChangesFilters }>({
    generation: 0,
    filters: { site, state, q: debouncedQuery },
  });
  /** True while a first page is on its way. */
  const isFirstPageInFlight = useRef(false);
  /** The newest `load`: a re-read after a write runs the current filters'. */
  const latestLoad = useRef<() => Promise<void>>(async () => {});
  /** Rows re-read after a write, by id, with the read they came from. */
  const rereads = useRef<ReadonlyMap<string, ReadRow>>(new Map());

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
    reads.current += 1;
    const read = reads.current;
    const filters = { site, state, q: debouncedQuery };
    active.current = { generation: current, filters };
    isFirstPageInFlight.current = true;
    setLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setHeld((previous) => ({
      ...EMPTY,
      frame: previous.data ? frameOf(previous.data) : previous.frame,
    }));
    try {
      const page = await fetchChanges(filters, 0);
      if (current !== generation.current) return;
      setHeld(firstPage(page, read, rereads.current));
    } catch (caught) {
      if (current !== generation.current) return;
      setError(caught instanceof Error ? caught.message : FALLBACK_ERROR);
    } finally {
      if (current === generation.current) {
        isFirstPageInFlight.current = false;
        setLoading(false);
      }
    }
  }, [site, state, debouncedQuery]);

  useEffect(() => {
    latestLoad.current = load;
    void load();
  }, [load]);

  const data = held.data;
  const loadMore = useCallback(async () => {
    if (!data || data.nextOffset === null || isLoadingMore) return;
    const current = generation.current;
    reads.current += 1;
    const read = reads.current;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await fetchChanges(
        { site, state, q: debouncedQuery },
        data.nextOffset,
      );
      if (current !== generation.current) return;
      setHeld((previous) => appendPage(previous, page, read, rereads.current));
    } catch (caught) {
      if (current !== generation.current) return;
      setError(caught instanceof Error ? caught.message : FALLBACK_ERROR);
    } finally {
      if (current === generation.current) setIsLoadingMore(false);
    }
  }, [data, isLoadingMore, site, state, debouncedQuery]);

  /**
   * A write to `elementId` landed: read again every row of it (every language
   * and variant: Publish promotes them all) and the current filters' counts
   * and total. A row is patched where it stands, so it keeps its place, its
   * open detail and its focus, even if it no longer matches the filter (the
   * owner sees what they did). A sibling the list does not hold is not added.
   *
   * Applies whatever the filters did meanwhile: the re-read is not tied to a
   * generation. A first page still in flight was asked for before the write
   * landed, so it is asked for again and its older answer dropped; a list
   * read that left before the write and lands after this one finds the
   * re-read row and draws it, never its own older copy.
   *
   * Resolves false when the server could not be read again: the page then
   * says so rather than show the row as current.
   */
  const refreshAfterWrite = useCallback(
    async (siteId: string, elementId: string): Promise<boolean> => {
      const rereadElement = async () => {
        reads.current += 1;
        const read = reads.current;
        try {
          const rows = await readElementChanges(siteId, elementId);
          const next = new Map(rereads.current);
          for (const row of rows) {
            if ((next.get(row.id)?.read ?? 0) < read) {
              next.set(row.id, { read, row });
            }
          }
          rereads.current = next;
          setHeld((previous) => patchRows(previous, rows, read));
          return true;
        } catch {
          return false;
        }
      };

      const rereadFrame = async () => {
        const owner = active.current;
        reads.current += 1;
        const read = reads.current;
        try {
          const page = await fetchChanges(owner.filters, 0);
          // A newer filter's first page owns the frame now.
          if (owner.generation === generation.current) {
            setHeld((previous) => patchFrame(previous, page, read));
          }
          return true;
        } catch {
          return false;
        }
      };

      const isReloading = isFirstPageInFlight.current;
      if (isReloading) void latestLoad.current();
      const [isRowRead, isFrameRead] = await Promise.all([
        rereadElement(),
        isReloading ? Promise.resolve(true) : rereadFrame(),
      ]);
      return isRowRead && isFrameRead;
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
    refreshAfterWrite,
    /** The search the data was read with (typing waits for the debounce). */
    appliedQuery: debouncedQuery,
  };
}
