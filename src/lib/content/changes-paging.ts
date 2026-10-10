/**
 * How far GET /api/content/changes pages (s70b), shared by the route that
 * enforces it and the page that tells the owner where the list stops.
 *
 * Tombstone (Devin review, PR #77): the route refused offsets past
 * `CHANGES_MAX_OFFSET` but still offered `nextOffset` 10,050 from the last
 * page it allowed, so "Show 50 more" was refused with a 400 on every click.
 * The route now stops offering a page past the ceiling, and the page says the
 * list is capped. Kept here, out of the route file (a route file may export
 * only its handlers), so the two can never disagree.
 */

/** Rows per read. */
export const CHANGES_PAGE_SIZE = 50;

/**
 * The last offset the route accepts. Beyond this an owner is not paging,
 * something is crawling: "Show 50 more" two hundred times is 10,000 rows, and
 * the view's CASE runs per row skipped.
 */
export const CHANGES_MAX_OFFSET = 10_000;

/** The most rows "Show 50 more" can ever reach: the last page included. */
export const CHANGES_LIST_CEILING = CHANGES_MAX_OFFSET + CHANGES_PAGE_SIZE;
