import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { DATAFAST_ORIGIN, isDataFastEnabled } from "./datafast";
import { isDataFastId } from "./datafast-attribution";
import {
  DATAFAST_GOALS,
  sanitizeGoalParams,
  type DataFastGoalParams,
  type DataFastServerGoal,
} from "./datafast-goals";

/**
 * Server-side DataFast goals (ADR 074): `POST https://datafa.st/api/v1/goals`
 * with `Authorization: Bearer <df_ website API key>` and a body of
 * `{ datafast_visitor_id, name, metadata? }` (docs: /docs/api/website/goals/create).
 *
 * INERT UNTIL `DATAFAST_API_KEY` IS SET. With no key nothing here sends,
 * reads or writes anything — not even the visitor-id row — so merging this
 * changes no runtime behaviour until the owner creates the key. The
 * `NEXT_PUBLIC_DATAFAST_DISABLED` switch turns it off too.
 *
 * NEVER THROWS, NEVER BLOCKS LONG. Every caller is an auth redirect, a site
 * registration, an embed check-in or a publish; a goal is worth nothing next
 * to any of them. Calls are 2-second bounded and every failure is swallowed
 * here. Callers schedule them with `after()` so not even the 2 s is on the
 * response path.
 *
 * NEVER LOGS THE KEY OR A PERSON. The failure report carries the goal name and
 * an outcome code — no visitor id, no user id, no response body. A 404 is
 * DataFast's normal "this visitor has no pageviews" (an ad blocker, a phone that
 * never loaded the marketing site) and is a breadcrumb, not an error.
 */

export const DATAFAST_GOALS_API_URL = `${DATAFAST_ORIGIN}/api/v1/goals`;
const DATAFAST_TIMEOUT_MS = 2_000;
const DB_TIMEOUT_MS = 1_500;

export type DataFastSendResult = "sent" | "disabled" | "invalid" | "failed";

function apiKey(): string | null {
  if (!isDataFastEnabled()) return null;
  const key = process.env.DATAFAST_API_KEY?.trim();
  return key ? key : null;
}

/** Whether server goals (and the visitor-id store behind them) are live. */
export function isDataFastServerEnabled(): boolean {
  return apiKey() !== null;
}

function reportFailure(name: string, code: string): void {
  try {
    console.warn(`[datafast] goal ${name} not delivered (${code})`);
    Sentry.addBreadcrumb({
      category: "datafast",
      level: "warning",
      message: `goal ${name} not delivered`,
      data: { code },
    });
    if (code !== "http_404") {
      Sentry.captureMessage(`[datafast] goal not delivered`, {
        level: "warning",
        tags: { area: "analytics", datafast_goal: name, datafast_code: code },
      });
    }
  } catch {
    // Reporting is best effort too.
  }
}

export interface DataFastGoalInput<N extends DataFastServerGoal> {
  visitorId: string | null | undefined;
  name: N;
  metadata?: DataFastGoalParams[N];
}

export async function sendDataFastGoal<N extends DataFastServerGoal>({
  visitorId,
  name,
  metadata,
}: DataFastGoalInput<N>): Promise<DataFastSendResult> {
  const key = apiKey();
  if (!key) return "disabled";
  if (!isDataFastId(visitorId)) return "invalid";
  const clean = sanitizeGoalParams(metadata);
  try {
    const response = await fetch(DATAFAST_GOALS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        datafast_visitor_id: visitorId,
        name,
        ...(Object.keys(clean).length > 0 ? { metadata: clean } : {}),
      }),
      signal: AbortSignal.timeout(DATAFAST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      reportFailure(name, `http_${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    reportFailure(
      name,
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "transport",
    );
    return "failed";
  }
}

/**
 * Keep the account's latest DataFast visitor id (service-role-only table,
 * `datafast_visitors`). It exists for the two goals whose request carries no
 * cookie of ours: the embed check-in and the widget's publish both arrive from
 * the CUSTOMER's domain, where our first-party cookie is never sent.
 */
export async function rememberDataFastVisitor(
  userId: string,
  visitorId: string,
): Promise<void> {
  if (!isDataFastServerEnabled() || !isDataFastId(visitorId)) return;
  try {
    const { error } = await createServiceRoleClient()
      .from("datafast_visitors")
      .upsert(
        {
          user_id: userId,
          visitor_id: visitorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) console.warn("[datafast] visitor store unavailable");
  } catch {
    console.warn("[datafast] visitor store unavailable");
  }
}

/**
 * The stored visitor id of the site's owner — its earliest `admin` row in
 * `site_permissions` (ownership is never a column on `sites`, AGENTS.md).
 * Null on any failure: no goal is better than a misattributed one.
 */
export async function dataFastVisitorForSiteOwner(
  siteId: string,
): Promise<string | null> {
  if (!isDataFastServerEnabled()) return null;
  try {
    const db = createServiceRoleClient();
    const { data: owner, error: ownerError } = await db
      .from("site_permissions")
      .select("user_id")
      .eq("site_id", siteId)
      .eq("permission", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    const userId = (owner as { user_id?: unknown } | null)?.user_id;
    if (ownerError || typeof userId !== "string") return null;
    const { data: visitor, error: visitorError } = await db
      .from("datafast_visitors")
      .select("visitor_id")
      .eq("user_id", userId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    const visitorId = (visitor as { visitor_id?: unknown } | null)?.visitor_id;
    return !visitorError && isDataFastId(visitorId) ? visitorId : null;
  } catch {
    return null;
  }
}

/** A milestone goal for a site, attributed to its owner's stored visit. */
export async function sendSiteOwnerGoal(
  siteId: string,
  name: "script_installed" | "first_edit_published",
): Promise<DataFastSendResult> {
  if (!isDataFastServerEnabled()) return "disabled";
  const visitorId = await dataFastVisitorForSiteOwner(siteId);
  return sendDataFastGoal({ visitorId, name });
}

/**
 * `first_edit_published`: the publish that wrote a site's first `publish`
 * history rows. The RPC writes one `staging_history` row per element it
 * published, so the site's first publish is the one after which the site holds
 * exactly as many publish rows as this call published. Two first publishes in
 * the same instant could both see a larger count and send nothing — the route
 * caps publishing at 10/min per site, and a missed goal is the safe failure.
 * Per site, not per account: ADR 007's account milestone table never shipped.
 */
export async function sendFirstPublishGoal(
  siteId: string,
  publishedCount: number,
): Promise<DataFastSendResult> {
  if (!isDataFastServerEnabled() || publishedCount < 1) return "disabled";
  try {
    const { count, error } = await createServiceRoleClient()
      .from("staging_history")
      .select("content_element_id, content_elements!inner(site_id)", {
        count: "exact",
        head: true,
      })
      .eq("action", "publish")
      .eq("content_elements.site_id", siteId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error || typeof count !== "number" || count > publishedCount) {
      return "invalid";
    }
  } catch {
    return "failed";
  }
  return sendSiteOwnerGoal(siteId, DATAFAST_GOALS.firstEditPublished);
}

/** What `ensureTrialStarted` reports (src/lib/billing/trial.ts). */
export type TrialStart = "founding" | "standard" | null | undefined | void;

/**
 * Everything DataFast learns from a verified session (auth callback/confirm).
 *
 * WHY `signup` IS KEYED ON THE TRIAL. Sign-up is passwordless
 * `signInWithOtp`: the first sign-in and the tenth run the same code, and the
 * s111 freeze (`freeze_analytics_signup`) returns the same row on every call,
 * so it cannot say "first". `ensureTrialStarted` can: it writes only when the
 * account has never had an entitlement, and the one-trial-per-account index
 * makes that true once per account, ever. So a session that started a trial
 * is the account's signup, and both goals fire from it.
 */
export async function recordDataFastSession({
  userId,
  visitorId,
  trial,
}: {
  userId: string;
  visitorId: string | null;
  trial: TrialStart;
}): Promise<void> {
  if (!isDataFastServerEnabled() || !visitorId) return;
  await rememberDataFastVisitor(userId, visitorId);
  if (trial !== "founding" && trial !== "standard") return;
  await sendDataFastGoal({ visitorId, name: DATAFAST_GOALS.signup });
  await sendDataFastGoal({
    visitorId,
    name: DATAFAST_GOALS.appTrialStarted,
    metadata: { offer: trial },
  });
}
