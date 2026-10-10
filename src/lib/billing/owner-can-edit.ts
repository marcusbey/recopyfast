import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import { resolveSiteOwnerId } from "@/lib/feature-gating/permissions";

/**
 * Editing needs the SITE OWNER's plan (s51, ADR 041).
 *
 * WHAT BROKE. Nothing on the write side read a plan. The only plan checks were
 * site creation, seats, A/B generation and the middleware's page redirect —
 * which lets credit holders through and never runs for `/api`. A lapsed trial,
 * a credits-only account, or an owner whose subscription had ended kept
 * saving and publishing live, and so did every editor they had invited and
 * every API key they had minted: edit sessions last up to 24 h, device grants
 * slide for 7 days, API keys never expire. Every write handler and every
 * credential issuance asks this one helper now — bar handoff redemption,
 * whose code is only checked inside the call that mints the grant (ADR 041).
 *
 * KEYED BY THE OWNER, NEVER THE CALLER. The caller may be an editor on a
 * device grant with no account at all, or a collaborator whose own plan must
 * not stand in for the owner's. The owner is the earliest `admin` row
 * (`resolveSiteOwnerId`), read with the service role for the same reason
 * `ai/suggest` does (ADR 035): RLS would hide the owner's entitlement from a
 * collaborator. That is also why every caller must authorize BEFORE calling
 * this — a plan-ended answer to an anonymous caller would tell anyone holding
 * a site id (it is in the public snippet) whether that customer lapsed.
 *
 * FAILS CLOSED, BUT HONESTLY. A read error refuses the write with a retryable
 * 503, not with "your plan ended": a Supabase blip must not tell a paying
 * customer they lapsed. The middleware fails OPEN on the same error, and that
 * stays — it only routes pages; this guards writes.
 *
 * NOTHING IS REVOKED. A lapse refuses writes; it never touches a session, a
 * grant, an editor row or a key. When the owner picks a plan the very same
 * credential works again, with nothing reissued.
 */

export const PLAN_ENDED_MESSAGE =
  "This site's plan has ended — the owner can reactivate it.";

const UNAVAILABLE_MESSAGE =
  "Editing is unavailable right now. Please try again in a moment.";

export type OwnerCanEditRefusalReason =
  | "plan_ended"
  | "no_owner"
  | "unavailable";

export type OwnerCanEdit =
  | { ok: true; ownerId: string }
  | { ok: false; reason: OwnerCanEditRefusalReason };

/**
 * Whether the owner of `siteId` holds a plan, which is what every content
 * write and every credential issuance requires.
 *
 * `credits` is not a plan: purchased credits are kept, but they buy no
 * editing and no AI spend until the owner chooses one.
 */
export async function checkOwnerCanEdit(siteId: string): Promise<OwnerCanEdit> {
  let service: ReturnType<typeof createServiceRoleClient>;
  let ownerId: string | null;
  try {
    service = createServiceRoleClient();
    ownerId = await resolveSiteOwnerId(service, siteId);
  } catch (error) {
    console.error(
      `[owner-can-edit] could not resolve the owner of site ${siteId}; refusing the write:`,
      error,
    );
    return { ok: false, reason: "unavailable" };
  }

  if (!ownerId) {
    // A site with no `admin` row is a data inconsistency, not a permitted
    // state. Refused rather than attributed to the caller, and logged because
    // an ownerless site is a bug worth seeing — as `ai/suggest` does.
    console.error(
      `[owner-can-edit] site ${siteId} has no admin row; refusing the write`,
    );
    return { ok: false, reason: "no_owner" };
  }

  try {
    const entitlement = await resolveEntitlement(service, ownerId);
    return entitlement.kind === "plan"
      ? { ok: true, ownerId }
      : { ok: false, reason: "plan_ended" };
  } catch (error) {
    console.error(
      `[owner-can-edit] could not read the entitlement of the owner of site ${siteId}; refusing the write:`,
      error,
    );
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The response for a refused `checkOwnerCanEdit`.
 *
 * 402, NEVER 401 OR 403. The widget sends every 401/403 on a write to
 * `handleTerminalWriteFailure` (recopyfast.src.js), which forgets the edit
 * link, locks editing and shows "Session ended — draft kept". That is false
 * here and would break "nothing is revoked". Any other status shows the body's
 * own text, so a 402 carrying the message costs the embed 0 bytes.
 *
 * Both `error` and `message` carry the text: the widget and the dashboard read
 * `error`; the editor-auth routes, the code prompt and the `/edit` hub read
 * `message`.
 */
export function ownerCanEditRefusal(
  result: Extract<OwnerCanEdit, { ok: false }>,
): NextResponse {
  if (result.reason === "unavailable") {
    return NextResponse.json(
      {
        error: UNAVAILABLE_MESSAGE,
        message: UNAVAILABLE_MESSAGE,
        reason: result.reason,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      error: PLAN_ENDED_MESSAGE,
      message: PLAN_ENDED_MESSAGE,
      reason: result.reason,
      upgradeRequired: true,
    },
    { status: 402 },
  );
}
