/*
 * One date format for anything rendered on both the server and the client.
 *
 * `/blog` shipped React error #418 (hydration text mismatch) in production:
 * BlogPostList called `toLocaleDateString()` with no locale and no time zone,
 * so the prerendered HTML carried the build machine's `1/15/2024` and the
 * visitor's browser re-rendered `15/01/2024` — or `1/14/2024`, because a
 * date-only string like `2024-01-15` is UTC midnight and every zone west of
 * Greenwich reads it as the day before.
 *
 * Both the locale and the zone are pinned, so server and client produce the
 * same text and the printed day is the one that was recorded. Dropping
 * `timeZone` brings the bug back for every non-UTC visitor even though the
 * locale is fixed.
 */
const DISPLAY_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/**
 * Formats a date as `Jan 15, 2024`, identically in every environment.
 *
 * Returns an empty string for an unparseable value: `Intl.DateTimeFormat#format`
 * throws `RangeError` on an Invalid Date, where the `toLocaleDateString()` it
 * replaces returned the text "Invalid Date" — a bad row must not crash a page.
 */
export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DISPLAY_DATE_FORMAT.format(date);
}
