/**
 * The operator's switches for the free tools' scan (s96). Read from the
 * environment per request so a redeploy-free change in Vercel's settings takes
 * effect on the next cold start, and validated so a typo can never loosen a
 * cap: anything that is not a positive integer means "the constant".
 *
 * - `TOOLS_SCAN_DISABLED=1` — the kill switch: every scan answers 503 before
 *   anything else runs (docs/operations/free-tools.md).
 * - `TOOLS_SCAN_GLOBAL_DAILY_CAP` — the launch-day override for the 500 scans
 *   a day all callers share (architect decision 2).
 * - `TOOLS_SCAN_DENYLIST` — see `denylist.ts`.
 */

export const TOOLS_SCAN_GLOBAL_DAILY_CAP = 500;

type Environment = Record<string, string | undefined>;

export function isScanDisabled(env: Environment = process.env): boolean {
  return env.TOOLS_SCAN_DISABLED === "1";
}

export function globalDailyCap(env: Environment = process.env): number {
  const raw = env.TOOLS_SCAN_GLOBAL_DAILY_CAP?.trim();
  if (!raw || !/^\d+$/.test(raw)) return TOOLS_SCAN_GLOBAL_DAILY_CAP;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : TOOLS_SCAN_GLOBAL_DAILY_CAP;
}
