/**
 * Shared plumbing for the /api/editor routes: where a request claims to come
 * from, whether that claim is consistent with the site it names, and the two
 * rate limits that stand in front of anything which sends mail or checks a code.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { normalizeOrigin } from "@/lib/auth/editor-crypto";
import type { DeviceContext } from "@/lib/auth/editor-grants";

/**
 * Build the device context a grant is bound to.
 *
 * Returns null when there is no usable Origin. A widget request always carries
 * one (it is cross-origin by definition), so its absence means the caller is not
 * the widget and we have nothing to bind to — refusing is the only safe answer.
 */
export function readDeviceContext(request: NextRequest): DeviceContext | null {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) return null;

  return {
    origin,
    userAgent: request.headers.get("user-agent"),
    ip: getClientIp(request),
  };
}

/**
 * Does this origin belong to this site?
 *
 * Checked when a grant is minted, not only when it is used. Without it an
 * authorised editor could mint a grant bound to an origin they control and
 * host a convincing clone of the customer's site that really does load and save
 * the customer's content.
 *
 * Subdomains are accepted: sites are commonly registered as `example.com` and
 * served from `www.example.com`. A registered `www.example.com` does NOT accept
 * a bare `example.com`, because the narrower registration is the more
 * deliberate one.
 */
export async function originBelongsToSite(
  siteId: string,
  origin: string,
): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data: site, error } = await supabase
    .from("sites")
    .select("domain")
    .eq("id", siteId)
    .maybeSingle();

  if (error || !site?.domain) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  const registered = site.domain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();

  if (!registered) return false;

  if (originHost === registered || originHost.endsWith(`.${registered}`)) {
    return true;
  }

  // Local development against a real site row. Gated on NODE_ENV so this can
  // never widen the check in a deployed environment.
  if (
    process.env.NODE_ENV !== "production" &&
    (originHost === "localhost" || originHost === "127.0.0.1")
  ) {
    console.warn(
      `[editor-auth] accepting development origin ${origin} for site ${siteId} (registered: ${registered})`,
    );
    return true;
  }

  return false;
}

/**
 * Throttle code sending on both axes that matter.
 *
 * Per email+site, because the on-site unlock button lets anyone who can load the
 * customer's page ask us to mail a specific editor — an email-bombing vector
 * aimed at a named person. Per IP as well, so one source cannot walk a list of
 * addresses.
 *
 * Both fail CLOSED. Losing Redis must not remove the only thing standing between
 * an attacker and an editor's inbox, and code requests are low-volume enough
 * that refusing during an outage costs little.
 */
export async function limitCodeRequests(
  request: NextRequest,
  params: { email: string; siteId: string | null },
): Promise<NextResponse | null> {
  const scope = params.siteId ?? "hub";

  const perRecipient = await enforceRateLimit(request, {
    limit: "USER_DOMAIN_VERIFY",
    endpoint: "editor/request-code:recipient",
    identifier: `${params.email}|${scope}`,
    identifierType: "user",
    onStoreFailure: "deny",
    message: "Too many codes requested for this address. Try again shortly.",
  });
  if (perRecipient) return perRecipient;

  return enforceRateLimit(request, {
    limit: "IP_AUTH",
    endpoint: "editor/request-code:ip",
    identifierType: "ip",
    onStoreFailure: "deny",
    message: "Too many code requests. Try again shortly.",
  });
}

/**
 * Throttle code submission before the code is compared.
 *
 * Same shape as the guard in src/app/api/staging/verify/route.ts: the attempt is
 * counted first, so a wrong guess costs budget whether or not it is close. Keyed
 * on the address rather than the IP, because the thing being brute-forced is one
 * mailbox's 10^6-space code and an attacker can trivially change IP.
 */
export async function limitCodeAttempts(
  request: NextRequest,
  params: { email: string; siteId: string | null },
): Promise<NextResponse | null> {
  const scope = params.siteId ?? "hub";

  const perAddress = await enforceRateLimit(request, {
    limit: "API_AUTH",
    endpoint: "editor/submit-code:address",
    identifier: `${params.email}|${scope}`,
    identifierType: "user",
    onStoreFailure: "deny",
    message: "Too many attempts. Try again later.",
  });
  if (perAddress) return perAddress;

  return enforceRateLimit(request, {
    limit: "IP_AUTH",
    endpoint: "editor/submit-code:ip",
    identifierType: "ip",
    onStoreFailure: "deny",
    message: "Too many attempts. Try again later.",
  });
}

/** Throttle grant validation — cheap, but not free, and callable by anyone. */
export async function limitGrantChecks(
  request: NextRequest,
  endpoint: string,
): Promise<NextResponse | null> {
  return enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint,
    identifierType: "ip",
    // Best-effort: a Redis blip must not sign every editor out mid-edit, and an
    // unmetered window on a read-only signature check is bounded in cost.
    onStoreFailure: "allow",
  });
}

/** Parse a JSON body without letting a malformed one become a 500. */
export async function readJsonBody(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readString(
  body: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = body?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
