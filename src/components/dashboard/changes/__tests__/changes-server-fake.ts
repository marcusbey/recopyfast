/**
 * An in-memory stand-in for the three routes the Changes page talks to (s70b
 * fix pass, C1): GET /api/content/changes, PUT /api/staging/content/<site>
 * and POST /api/staging/publish. Not a test suite (jest runs `*.test.*`).
 *
 * Why it exists: the page now reads the server again after every write
 * instead of drawing what the write meant to do. A `fetch` mock that answers
 * every read with the same rows would undo each write on the next read, so
 * the view's tests need a server that remembers. This one follows the real
 * SQL closely enough to catch the bug the fix pass is about:
 * - the save RPC (20260924030000, `save_staging_content_atomic`) stores the
 *   draft text as sent, MERGES the attribute patch into the staged ones and
 *   drops a staged key equal to the live one;
 * - the publish RPC (20260924060000) promotes EVERY row of the element ids it
 *   is given, every language and variant, that has a draft differing from
 *   live or a staged attribute differing from live;
 * - the view (20261009120000) derives the state and `changed_at`;
 * - `published_content` may be NULL, as a translation writes it
 *   (src/app/api/ai/translate/route.ts): seed a row with `hasLiveText:
 *   false`. The list route then answers the original as "Live now", the view
 *   reads the row as Published (NULL is distinct from the original), and any
 *   draft saved on it stays Pending, because no saved text equals NULL.
 * Rows are answered in the order they were seeded (ordering is not under
 * test here) and `q` is a plain case-insensitive substring.
 */

export interface FakeSite {
  id: string;
  name: string;
  domain: string;
  permission: string;
}

/** A row as the list route answers it (the seed shape the tests use). */
export type SeedRow = Record<string, unknown> & { id: string };

interface DraftAttribute {
  name: string;
  live: string | null;
}

interface StoredRow {
  base: Record<string, unknown>;
  siteId: string;
  elementId: string;
  language: string;
  variant: string;
  pagePath: string | null;
  original: string | null;
  published: string | null;
  staging: string | null;
  liveAttributes: Record<string, string>;
  stagedAttributes: Record<string, string>;
  /** The route could not read this row's metadata: it answers null. */
  isMetadataUnread: boolean;
  publishedAt: string | null;
  stagingUpdatedAt: string | null;
  updatedAt: string;
}

const PAGE_SIZE = 50;
const ATTRIBUTE_KEYS = ["href", "alt"] as const;

let clock = Date.parse("2026-10-09T12:00:00.000Z");
const tick = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function seed(row: SeedRow): StoredRow {
  const state = row.state;
  const changedAt = text(row.changedAt) ?? new Date(clock).toISOString();
  const listed = Array.isArray(row.draftAttributes)
    ? (row.draftAttributes as DraftAttribute[])
    : [];
  const liveAttributes: Record<string, string> = {};
  const stagedAttributes: Record<string, string> = {};
  for (const { name, live } of listed) {
    if (live !== null) liveAttributes[name] = live;
    // The route never sends a staged value; any value unlike the live one
    // stages the key, as the save RPC keeps it.
    if (state === "pending") stagedAttributes[name] = `${live ?? ""}#staged`;
  }
  return {
    base: row,
    siteId: String(row.siteId),
    elementId: String(row.elementId),
    language: String(row.language),
    variant: String(row.variant),
    pagePath: text(row.pagePath),
    original: text(row.original),
    published: row.hasLiveText === false ? null : text(row.live),
    staging: text(row.draft),
    liveAttributes,
    stagedAttributes,
    isMetadataUnread: state === "pending" && row.draftAttributes === null,
    publishedAt: state === "published" ? changedAt : null,
    stagingUpdatedAt: state === "pending" ? changedAt : null,
    updatedAt: changedAt,
  };
}

const changedAttributes = (row: StoredRow): Record<string, string> =>
  Object.fromEntries(
    Object.entries(row.stagedAttributes).filter(
      ([name, value]) => row.liveAttributes[name] !== value,
    ),
  );

function changeState(row: StoredRow): "pending" | "published" | "original" {
  const isPending =
    (row.staging !== null && row.staging !== row.published) ||
    Object.keys(changedAttributes(row)).length > 0;
  if (isPending) return "pending";
  if (row.published !== row.original || row.publishedAt !== null) {
    return "published";
  }
  return "original";
}

function toAnswer(row: StoredRow): SeedRow {
  const state = changeState(row);
  const draftAttributes =
    state !== "pending"
      ? []
      : row.isMetadataUnread
        ? null
        : Object.keys(row.stagedAttributes).map((name) => ({
            name,
            live: row.liveAttributes[name] ?? null,
          }));
  return {
    ...row.base,
    id: String(row.base.id),
    original: row.original,
    live: row.published ?? row.original,
    draft: row.staging,
    draftAttributes,
    hasLiveText: row.published !== null,
    state,
    changedAt:
      state === "pending"
        ? row.stagingUpdatedAt
        : (row.publishedAt ?? row.updatedAt),
  };
}

export interface FakeChangesServer {
  /** The list route's answer for a URL, or null for a site not the caller's. */
  list(url: URL): Record<string, unknown> | null;
  /** The staging PUT's write; false when no row matches. */
  put(siteId: string, body: Record<string, unknown>): boolean;
  /** The publish POST's write. */
  publish(body: Record<string, unknown>): void;
}

export function createFakeChangesServer(
  rows: SeedRow[],
  {
    sites,
    unlistedOriginals = 0,
  }: { sites: FakeSite[]; unlistedOriginals?: number },
): FakeChangesServer {
  let stored = rows.map(seed);

  const searchText = (row: StoredRow) =>
    [row.original, row.published, row.staging, row.pagePath]
      .filter((value) => value !== null)
      .join(" ")
      .toLowerCase();

  return {
    list(url) {
      const params = url.searchParams;
      const site = params.get("site");
      const element = params.get("element");
      const state = params.get("state") ?? "changes";
      const q = (params.get("q") ?? "").trim().toLowerCase();
      const offset = Number(params.get("offset") ?? "0");
      if (site !== null && !sites.some((candidate) => candidate.id === site)) {
        return null;
      }

      const scoped = stored
        .filter(
          (row) =>
            (site === null || row.siteId === site) &&
            (element === null || row.elementId === element) &&
            (!q || searchText(row).includes(q)),
        )
        .map(toAnswer);
      const listed = scoped.filter((row) =>
        state === "all"
          ? true
          : state === "changes"
            ? row.state !== "original"
            : row.state === state,
      );
      const unlisted =
        site === null && element === null ? unlistedOriginals : 0;
      const countOf = (wanted: string) =>
        scoped.filter((row) => row.state === wanted).length;
      const pageRows = listed.slice(offset, offset + PAGE_SIZE);
      const reached = offset + pageRows.length;
      return {
        sites,
        rows: pageRows,
        total: listed.length + (state === "all" ? unlisted : 0),
        counts: {
          pending: countOf("pending"),
          published: countOf("published"),
          original: countOf("original") + unlisted,
        },
        nextOffset: reached < listed.length ? reached : null,
      };
    },

    put(siteId, body) {
      const target = stored.find(
        (row) =>
          row.siteId === siteId &&
          row.elementId === body.elementId &&
          row.language === body.language &&
          row.variant === body.variant,
      );
      if (!target) return false;
      const patch = Object.fromEntries(
        ATTRIBUTE_KEYS.filter((key) => typeof body[key] === "string").map(
          (key) => [key, body[key] as string],
        ),
      );
      const proposed = { ...target.stagedAttributes, ...patch };
      const now = tick();
      const saved: StoredRow = {
        ...target,
        staging: text(body.content),
        stagedAttributes: Object.fromEntries(
          Object.entries(proposed).filter(
            ([name, value]) => target.liveAttributes[name] !== value,
          ),
        ),
        stagingUpdatedAt: now,
        updatedAt: now,
      };
      stored = stored.map((row) => (row === target ? saved : row));
      return true;
    },

    publish(body) {
      const siteId = body.siteId;
      const elementIds = Array.isArray(body.elementIds)
        ? (body.elementIds as unknown[])
        : [];
      const now = tick();
      stored = stored.map((row) => {
        if (row.siteId !== siteId || !elementIds.includes(row.elementId)) {
          return row;
        }
        const changed = changedAttributes(row);
        const isChanged =
          (row.staging !== null && row.staging !== row.published) ||
          Object.keys(changed).length > 0;
        if (!isChanged) return row;
        return {
          ...row,
          published: row.staging ?? row.published,
          liveAttributes: { ...row.liveAttributes, ...changed },
          stagedAttributes: {},
          staging: null,
          stagingUpdatedAt: null,
          publishedAt: now,
          updatedAt: now,
        };
      });
    },
  };
}
