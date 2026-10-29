/**
 * "Install detected" owner email (s122).
 *
 * WHEN. Called from `POST /api/content/[siteId]` inside `after()`, only for the
 * one request whose `markSiteLive` guarded update matched — the same single
 * transition that fires DataFast `script_installed` (ADR 074). The check-in has
 * already answered; nothing here is on the widget's response path (ADR 010).
 *
 * RESOLVE, THEN CLAIM, THEN SEND. The site, its owner (`resolveSiteOwnerId`,
 * billing's definition) and the owner's address are read first and claim
 * nothing if any of them fails or times out — a transient lookup failure must
 * not become a permanent "no email" row for a site that has an owner.
 *
 * EXACTLY ONCE, TWICE OVER. The trigger already fires once per flip. The
 * ledger (`site_install_emails`, primary key `site_id`) is claimed BEFORE the
 * provider is called (ADR 011: "record what was sent before sending, not
 * after"), so a retried invocation, two concurrent check-ins that both somehow
 * believed they flipped the site, or a site that re-enters `awaiting-install`
 * finds the row and sends nothing. Unlike the digest ledger the claim is not
 * reclaimable: nothing re-fires the trigger after a failure, and a second email
 * for the same site is the defect this table exists to prevent.
 *
 * DEGRADES TO "NO EMAIL", NEVER TO "TWO EMAILS". Any claim error — including the
 * table not existing yet because the code deployed before the migration — skips
 * the send. A failure after the claim (provider rejection, a 5 s provider
 * timeout) marks the row `failed` with a short code.
 *
 * NEVER THROWS, NEVER LOGS A PERSON. Every failure is caught here and reported
 * with a stage and a code; no address, no provider message (which can echo
 * one). The site id is an opaque UUID and is what an operator needs to find
 * the ledger row.
 *
 * Transactional, so there is no opt-out to consult: the repo has no marketing
 * preference store (ADR 011's digest preference table never shipped), and this
 * is the one-time confirmation of an action the account took.
 */

import * as Sentry from "@sentry/nextjs";
import {
  isEmailProviderConfigured,
  sendInstallDetectedEmail,
} from "@/lib/email/resend";
import { resolveUserIdentity } from "@/lib/auth/user-identity";
import { resolveSiteOwnerId } from "@/lib/feature-gating/permissions";
import { getPublicAppUrl } from "@/lib/sites/embed-script";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type InstallEmailOutcome =
  | "sent"
  | "disabled"
  | "duplicate"
  | "skipped"
  | "failed";

const LEDGER_TABLE = "site_install_emails";

/**
 * Bounds on the two network waits inside `after()` (s122 review). Neither may
 * hold the invocation open indefinitely; both together stay well under the
 * function's own limit.
 */
const LOOKUP_TIMEOUT_MS = 5_000;
const SEND_TIMEOUT_MS = 5_000;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function report(stage: string, code: string, siteId: string): void {
  try {
    console.warn(
      `[install-email] site ${siteId}: not sent at ${stage} (${code})`,
    );
    Sentry.captureMessage("[install-email] owner email not sent", {
      level: "warning",
      tags: {
        area: "email",
        email: "install_detected",
        install_email_stage: stage,
        install_email_code: code,
      },
      extra: { siteId },
    });
  } catch {
    // Reporting is best effort too.
  }
}

/**
 * Take the site's one ledger row. True only for the caller that inserted it.
 *
 * `ignoreDuplicates` makes the insert `ON CONFLICT DO NOTHING`, so the loser of
 * a race gets zero rows back rather than an error — the same "zero rows is the
 * normal answer" shape `markSiteLive` uses.
 */
async function claim(
  db: ServiceClient,
  siteId: string,
): Promise<"claimed" | "duplicate" | "error"> {
  const { data, error } = await db
    .from(LEDGER_TABLE)
    .upsert(
      { site_id: siteId, status: "pending" },
      { onConflict: "site_id", ignoreDuplicates: true },
    )
    .select("site_id");
  if (error) {
    report("claim", error.code || "db_error", siteId);
    return "error";
  }
  return Array.isArray(data) && data.length > 0 ? "claimed" : "duplicate";
}

async function finish(
  db: ServiceClient,
  siteId: string,
  errorCode: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from(LEDGER_TABLE)
    .update(
      errorCode
        ? { status: "failed", error_code: errorCode, updated_at: now }
        : { status: "sent", sent_at: now, updated_at: now },
    )
    .eq("site_id", siteId)
    .eq("status", "pending");
  // The claim already blocks a resend, so a lost status write only loses the
  // record of the outcome. Report it; never throw.
  if (error) report("finish", error.code || "db_error", siteId);
}

class TimeoutError extends Error {}

/**
 * Settle with `promise`, or reject with `TimeoutError` after `ms`. The timer is
 * cleared either way so a settled call leaves nothing pending in `after()`.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function siteLabel(
  db: ServiceClient,
  siteId: string,
): Promise<{ name: string; domain: string } | null> {
  const { data, error } = await db
    .from("sites")
    .select("name, domain")
    .eq("id", siteId)
    .maybeSingle();
  if (error) throw new Error("site lookup failed");
  const site = data as { name?: unknown; domain?: unknown } | null;
  if (typeof site?.domain !== "string" || !site.domain) return null;
  return {
    domain: site.domain,
    name:
      typeof site.name === "string" && site.name.trim()
        ? site.name
        : site.domain,
  };
}

type Recipient = { to: string; siteName: string; siteDomain: string };

/**
 * Everything the send needs, resolved BEFORE the claim (s122 review).
 *
 * The owner is `resolveSiteOwnerId` — the same earliest-admin row, with the
 * same `id` tie-breaker, that billing, seats and editing charge — so the email
 * goes to the account that pays for the site, never to a manager who happened
 * to share its `created_at`.
 *
 * Nothing re-fires the trigger, so a row written for a transient failure here
 * (a lookup error, a GoTrue timeout) would be a permanent "no email" for a
 * site that has an owner. Resolving first means a failure here claims nothing:
 * the site has no row, and any later path that calls this again can still
 * send. A null address is also left unclaimed, because `resolveUserIdentity`
 * answers null for a lookup error as well as for a deleted user.
 */
async function resolveRecipient(
  db: ServiceClient,
  siteId: string,
): Promise<Recipient | string> {
  const site = await siteLabel(db, siteId);
  if (!site) return "no_site";
  let userId: string | null;
  try {
    userId = await resolveSiteOwnerId(db, siteId);
  } catch {
    return "owner_lookup_error";
  }
  if (!userId) return "no_owner";
  const owner = await resolveUserIdentity(userId);
  if (!owner?.email) return "no_owner_email";
  return { to: owner.email, siteName: site.name, siteDomain: site.domain };
}

async function deliver(
  siteId: string,
  recipient: Recipient,
): Promise<string | null> {
  try {
    const result = await withTimeout(
      sendInstallDetectedEmail({
        ...recipient,
        dashboardUrl: `${getPublicAppUrl()}/dashboard/sites/${encodeURIComponent(siteId)}`,
      }),
      SEND_TIMEOUT_MS,
    );
    return result.sent ? null : "provider_rejected";
  } catch (error) {
    // A timeout does not cancel the request (the SDK takes no signal), so the
    // mail may still arrive. The row says `provider_timeout`, not "not sent",
    // and the claim keeps a second send impossible either way.
    return error instanceof TimeoutError ? "provider_timeout" : "exception";
  }
}

/** The client and recipient, or the short code of why there is none. */
async function prepare(
  siteId: string,
): Promise<{ db: ServiceClient; recipient: Recipient } | string> {
  try {
    const db = createServiceRoleClient();
    const recipient = await withTimeout(
      resolveRecipient(db, siteId),
      LOOKUP_TIMEOUT_MS,
    );
    return typeof recipient === "string" ? recipient : { db, recipient };
  } catch (error) {
    return error instanceof TimeoutError ? "lookup_timeout" : "lookup_error";
  }
}

/**
 * Email the owner of a site that has just gone live for the first time.
 * Resolves an outcome for tests and logs; never rejects.
 */
export async function notifyOwnerOfInstall(
  siteId: string,
): Promise<InstallEmailOutcome> {
  // Checked before anything else: with no provider nothing is attempted, so no
  // row should say otherwise.
  if (!isEmailProviderConfigured()) return "disabled";

  const prepared = await prepare(siteId);
  if (typeof prepared === "string") {
    report("resolve", prepared, siteId);
    return "skipped";
  }
  const { db, recipient } = prepared;

  try {
    const claimed = await claim(db, siteId);
    if (claimed === "duplicate") return "duplicate";
    if (claimed === "error") return "skipped";
  } catch {
    report("claim", "exception", siteId);
    return "skipped";
  }

  const errorCode = await deliver(siteId, recipient);

  try {
    await finish(db, siteId, errorCode);
  } catch {
    report("finish", "exception", siteId);
  }

  if (errorCode) {
    report("send", errorCode, siteId);
    return "failed";
  }
  return "sent";
}
