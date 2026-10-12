/**
 * The GA4 measurement id — the on/off switch for Google Analytics (s107).
 *
 * `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set in Vercel for Production only, so a
 * preview deployment builds with no id and sends nothing. The id is public by
 * design (it is in every page that loads gtag.js), but it is interpolated into
 * a script URL, so anything that is not a GA4 id is treated as "off" rather
 * than passed through.
 */

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

export function parseMeasurementId(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return MEASUREMENT_ID_PATTERN.test(value) ? value : null;
}

/**
 * Read at call time. In the browser bundle Next inlines the literal
 * `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` at build time, which is why the
 * access is spelled out in full here and nowhere else.
 */
export function getMeasurementId(): string | null {
  return parseMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
}
