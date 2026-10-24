/**
 * "Install detected" owner email (s122).
 *
 * WHEN. Called from `POST /api/content/[siteId]` inside `after()`, only for the
 * one request whose `markSiteLive` guarded update matched — the same single
 * transition that fires DataFast `script_installed` (ADR 074). The check-in has
 * already answered; nothing here is on the widget's response path (ADR 010).
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
 * the send. Any later failure marks the row `failed` with a short code.
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
import { getPublicAppUrl } from "@/lib/sites/embed-script";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type InstallEmailOutcome =
  | "sent"
  | "disabled"
  | "duplicate"
  | "skipped"
  | "failed";

const LEDGER_TABLE = "site_install_emails";

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

/** The site's owner: its earliest `admin` row (never a `sites` column). */
async function ownerId(
  db: ServiceClient,
  siteId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("site_permissions")
    .select("user_id")
    .eq("site_id", siteId)
    .eq("permission", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const userId = (data as { user_id?: unknown } | null)?.user_id;
  return !error && typeof userId === "string" ? userId : null;
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
  const site = data as { name?: unknown; domain?: unknown } | null;
  if (error || typeof site?.domain !== "string" || !site.domain) return null;
  return {
    domain: site.domain,
    name:
      typeof site.name === "string" && site.name.trim()
        ? site.name
        : site.domain,
  };
}

async function deliver(
  db: ServiceClient,
  siteId: string,
): Promise<string | null> {
  const site = await siteLabel(db, siteId);
  if (!site) return "no_site";
  const userId = await ownerId(db, siteId);
  if (!userId) return "no_owner";
  const owner = await resolveUserIdentity(userId);
  if (!owner?.email) return "no_owner_email";

  const result = await sendInstallDetectedEmail({
    to: owner.email,
    siteName: site.name,
    siteDomain: site.domain,
    dashboardUrl: `${getPublicAppUrl()}/dashboard/sites/${encodeURIComponent(siteId)}`,
  });
  return result.sent ? null : "provider_rejected";
}

/**
 * Email the owner of a site that has just gone live for the first time.
 * Resolves an outcome for tests and logs; never rejects.
 */
export async function notifyOwnerOfInstall(
  siteId: string,
): Promise<InstallEmailOutcome> {
  // Checked before the claim: with no provider nothing is attempted, so no
  // row should say otherwise.
  if (!isEmailProviderConfigured()) return "disabled";

  let db: ServiceClient;
  try {
    db = createServiceRoleClient();
    const claimed = await claim(db, siteId);
    if (claimed === "duplicate") return "duplicate";
    if (claimed === "error") return "skipped";
  } catch {
    report("claim", "exception", siteId);
    return "skipped";
  }

  let errorCode: string | null;
  try {
    errorCode = await deliver(db, siteId);
  } catch {
    errorCode = "exception";
  }

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
