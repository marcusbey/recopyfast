import type { SupabaseClient } from "@supabase/supabase-js";
import type { SiteStatus } from "@/components/ui/status-badge";

/**
 * The install state machine, and the one place staleness is computed.
 *
 * `sites.status` holds exactly two values — `awaiting-install` and `live` — and
 * the database's CHECK constraint keeps it that way
 * (supabase/migrations/20260817001000_sites_install_status.sql). The third
 * state an owner sees, `stale`, is derived here from `last_reported_at` and is
 * never written anywhere.
 *
 * WHY DERIVED AND NOT STORED. A stored `stale` is a value some later code path
 * can gate on, and the story this implements is explicit that staleness must
 * never block content delivery or editing — it is a nudge, not a verdict.
 * Nothing can gate on a value that is never written. It also removes the
 * reconciliation window a cron would introduce, where a site reads `live` for
 * up to one cron interval after it has actually gone quiet. Full rationale and
 * the rejected alternatives: docs/decisions/006-site-status-persisted-state-machine.md.
 */

/** The two values `sites.status` is allowed to hold. */
export type PersistedSiteStatus = "awaiting-install" | "live";

export interface SiteStatusFields {
  /** `sites.status`, as read from the database. */
  status?: string | null;
  /** `sites.last_reported_at`, as read from the database. */
  last_reported_at?: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long a live site may stay quiet before the dashboard says so.
 *
 * Fourteen days, because the signal behind it is a page view on the customer's
 * own site: a low-traffic marketing page can genuinely go a week without one,
 * and calling that broken teaches owners to ignore the badge.
 */
const DEFAULT_STALE_AFTER_DAYS = 14;

/** Env override, in days. Anything not a positive finite number is ignored. */
const STALE_AFTER_DAYS_ENV = "SITE_STALE_AFTER_DAYS";

export function getStaleAfterMs(): number {
  const configured = Number(process.env[STALE_AFTER_DAYS_ENV]);

  // A zero or negative window would mark every site stale the instant it
  // reported, and NaN would compare false against everything and mark none.
  // Both are worse than the default, so a bad value is simply not honoured.
  const days =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_STALE_AFTER_DAYS;

  return days * MS_PER_DAY;
}

/**
 * The display status for one site: what every UI surface renders.
 *
 * Anything that is not persisted `live` reads as `awaiting-install`, including
 * an unknown value from a newer build — the fallback must never claim a site is
 * verified when we cannot tell.
 */
export function resolveEffectiveSiteStatus(
  fields: SiteStatusFields,
  now: Date | number = Date.now(),
): SiteStatus {
  if (fields.status !== "live") {
    return "awaiting-install";
  }

  if (!fields.last_reported_at) {
    // Live with no recorded report: the backfill found content_elements rows
    // with no usable created_at, or a write path flipped the status without
    // dating it. "We do not know when you last reported" is not "you have gone
    // quiet", and inventing an alarm out of missing data is the one way this
    // advisory becomes noise.
    return "live";
  }

  const lastReportedAt = new Date(fields.last_reported_at).getTime();
  if (Number.isNaN(lastReportedAt)) {
    return "live";
  }

  const nowMs = now instanceof Date ? now.getTime() : now;

  return nowMs - lastReportedAt > getStaleAfterMs() ? "stale" : "live";
}

function throwOnWriteError(operation: string, error: unknown): void {
  if (!error) return;

  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);

  throw new Error(`${operation} failed: ${detail}`);
}

/**
 * Flip a site to `live` on its first authenticated content report.
 *
 * WRITE-ONCE, ENFORCED IN THE WHERE CLAUSE. `live_at` answers "when did this
 * site first come up", which s03 reads as an activation milestone, so it must
 * not be overwritten by the second report — or by the two-hundredth. Reading
 * the status and then writing it would lose that race the first time two
 * visitors landed at the same moment: both would see `awaiting-install`, both
 * would write, and the later `live_at` would win. The guard makes the second
 * update match zero rows instead, which is not an error — it is the normal
 * case for every request after the first.
 */
export async function markSiteLive(
  supabase: SupabaseClient,
  siteId: string,
  at: Date = new Date(),
): Promise<void> {
  const timestamp = at.toISOString();

  const { error } = await supabase
    .from("sites")
    .update({
      status: "live",
      live_at: timestamp,
      last_reported_at: timestamp,
    })
    .eq("id", siteId)
    .eq("status", "awaiting-install");

  throwOnWriteError("markSiteLive", error);
}

/**
 * Record that this site's script has just been heard from.
 *
 * Unconditional, unlike `markSiteLive`: this is the liveness signal, and it has
 * to keep landing for a site that is already live. It is the only thing that
 * ever brings a site back out of the derived `stale` state.
 */
export async function recordSiteReport(
  supabase: SupabaseClient,
  siteId: string,
  at: Date = new Date(),
): Promise<void> {
  const { error } = await supabase
    .from("sites")
    .update({ last_reported_at: at.toISOString() })
    .eq("id", siteId);

  throwOnWriteError("recordSiteReport", error);
}
