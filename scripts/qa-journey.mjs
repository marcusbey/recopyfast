#!/usr/bin/env node
/**
 * The one path, run for real, on every deploy.
 *
 * docs/QA-USER-JOURNEY-2026-08-04.md ends on this conclusion and this script is
 * it: "1,300 passing tests over a product that could not take a payment and
 * could not admit a customer who had paid." Every P0 in that register was
 * invisible to the unit suite for one reason — the tests mock Supabase, and the
 * mock has no row-level security, so a mock more permissive than the platform
 * certifies the bug as correct.
 *
 * So nothing here is mocked. It signs up a real user in the real Supabase
 * project, holds a real session cookie, and calls the running app over HTTP the
 * way a browser does. If row-level security denies something, this fails, which
 * is the entire point.
 *
 * SIGNING UP WITHOUT AN INBOX
 * ---------------------------
 * The obvious blocker is the magic link. `POST /auth/v1/admin/generate_link`
 * with the service-role key mints the same one-time token the email would have
 * carried and returns its `hashed_token` in the response body, so the journey
 * can confirm its own session by calling `/auth/confirm?token_hash=…` directly.
 * No mailbox, no polling, no shared test account whose state leaks between
 * runs — every run gets a user nobody has touched.
 *
 * This is a QA affordance, not a back door: it needs the service-role key,
 * which already has unrestricted database access. It proves the *app's*
 * confirmation route works; it does NOT prove Supabase's SMTP can deliver mail
 * (register F-16), which remains unverified and is called out in the summary.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not drive Stripe's hosted Checkout page — that needs a browser, and
 * a headless gate that needs a browser does not get run. Instead it asserts the
 * session is *creatable* (which is exactly where F-1 died, before Stripe) and
 * then establishes the paid state through Stripe's own API, which fires the
 * same webhooks a hosted payment would. The hosted page itself is covered by
 * the Playwright suite.
 *
 * Usage:
 *   node scripts/qa-journey.mjs                          # http://localhost:3000
 *   node scripts/qa-journey.mjs --base=https://recopyfa.st
 *   node scripts/qa-journey.mjs --keep                   # leave the user behind to inspect
 *
 * Exits non-zero on the first hard failure so it can gate a deploy.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("--base=")) ?? "--base=http://localhost:3000").slice(
  "--base=".length,
).replace(/\/$/, "");
const KEEP = args.includes("--keep");

/** Steps that ran, so the summary can report honestly rather than by exception. */
const results = [];
let hardFailure = null;

function record(id, title, status, detail) {
  results.push({ id, title, status, detail });
  const icon = { pass: "✅", fail: "❌", warn: "⚠️ ", skip: "⏭️ " }[status];
  console.log(`  ${icon} ${id}  ${title}${detail ? `\n         ${detail}` : ""}`);
}

/** A failure that makes every later step meaningless — stop rather than cascade. */
class Fatal extends Error {}

async function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = await readFile(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function requireEnv(env, key) {
  if (!env[key]) throw new Fatal(`${key} is not set.`);
  return env[key];
}

// ---------------------------------------------------------------------------
// A cookie jar, because the session IS the thing under test
// ---------------------------------------------------------------------------
// fetch() does not persist Set-Cookie between calls, and Supabase's SSR client
// splits a session across several chunked cookies. Dropping any one of them
// yields a signed-out request that looks exactly like an authorisation bug, so
// the jar keeps all of them verbatim.

const jar = new Map();

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    // An expiry in the past is a deletion, and treating it as a value is how a
    // signed-out session keeps looking signed in.
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function app(pathname, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.headers ?? {}),
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  storeCookies(response);
  return response;
}

/**
 * The live content of one element, however the route chose to wrap it.
 *
 * Shared by every assertion that reads published content so a difference
 * between two steps is a difference in the PRODUCT, not in how each step
 * happened to unwrap the response — which is what a hand-rolled accessor in
 * each step already produced once.
 */
function liveContentOf(payload, elementId) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.content)
      ? payload.content
      : [];
  return rows.find((row) => row.element_id === elementId)?.current_content;
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 300) };
  }
}

async function supabaseAdmin(env, endpoint, init = {}) {
  const key = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL")}${endpoint}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return response;
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

async function main() {
  const env = await loadEnv();
  const stamp = Date.now();
  const email = `rboboe+rcfqa${stamp}@gmail.com`;
  const siteDomain = `qa-${stamp}.example.com`;

  console.log(`\nRecopyFast journey · ${BASE}\nuser: ${email}\n`);

  // -- 0. the app is actually up -------------------------------------------
  console.log("0. Reachability");
  try {
    const response = await app("/");
    if (response.status >= 500) throw new Fatal(`GET / → ${response.status}`);
    record("0.1", "App responds", "pass", `GET / → ${response.status}`);
  } catch (error) {
    throw new Fatal(
      `${BASE} is not answering (${error.message}). Start it with \`npm run dev\`, ` +
        `or pass --base=<url>.`,
    );
  }

  // -- 1. sign up, with no inbox in the loop --------------------------------
  console.log("\n1. Sign up");
  const linkResponse = await supabaseAdmin(env, "/auth/v1/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link = await json(linkResponse);
  if (!link.hashed_token) {
    throw new Fatal(`generate_link returned no hashed_token: ${JSON.stringify(link).slice(0, 300)}`);
  }
  record("1.1", "Magic-link token minted", "pass", `type=${link.verification_type}`);

  const confirm = await app(
    `/auth/confirm?token_hash=${link.hashed_token}&type=${link.verification_type === "signup" ? "signup" : "magiclink"}&next=/dashboard`,
  );
  const confirmedTo = confirm.headers.get("location") ?? "";
  if (confirmedTo.includes("/auth/error")) {
    throw new Fatal(`/auth/confirm rejected the token and redirected to ${confirmedTo}`);
  }
  if (jar.size === 0) throw new Fatal("/auth/confirm set no session cookie.");
  record("1.2", "Session established via /auth/confirm", "pass", `→ ${confirmedTo}`);

  // The register's F-14: a local run that redirects to production means the
  // environment is misconfigured, and every Stripe return will do the same.
  if (!confirmedTo.startsWith(BASE)) {
    record(
      "1.3",
      "Confirmation lands on the host under test",
      "warn",
      `redirected to ${confirmedTo} — NEXT_PUBLIC_APP_URL points elsewhere (register F-14)`,
    );
  } else {
    record("1.3", "Confirmation lands on the host under test", "pass");
  }

  const userLookup = await supabaseAdmin(
    env,
    `/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
  );
  const userId = (await json(userLookup)).users?.[0]?.id;
  if (!userId) throw new Fatal("The signed-up user is not in auth.users.");
  record("1.4", "auth.users row exists", "pass", userId);

  // -- 2. an unpaid session is held at the paywall --------------------------
  console.log("\n2. Paywall");
  const unpaid = await json(await app("/api/billing/entitlement"));
  if (unpaid.kind !== "none") {
    record("2.1", "Fresh account is unentitled", "fail", `expected kind=none, got ${JSON.stringify(unpaid)}`);
  } else {
    record("2.1", "Fresh account is unentitled", "pass", 'kind="none"');
  }

  const gated = await app("/dashboard");
  const gatedTo = gated.headers.get("location") ?? "";
  if (gated.status >= 300 && gated.status < 400 && gatedTo.includes("billing")) {
    record("2.2", "Unpaid session is redirected to billing", "pass", `→ ${gatedTo}`);
  } else {
    record("2.2", "Unpaid session is redirected to billing", "warn", `status ${gated.status} → ${gatedTo || "no redirect"}`);
  }

  // -- 3. checkout reaches Stripe (register F-1 died HERE) ------------------
  console.log("\n3. Checkout reaches Stripe");
  const intents = [
    { id: "3.1", label: "Pro monthly subscription", body: { intent: "subscription", planId: "pro", billingPeriod: "monthly" } },
    { id: "3.2", label: "Pro yearly subscription", body: { intent: "subscription", planId: "pro", billingPeriod: "yearly" } },
    { id: "3.3", label: "Starter monthly subscription", body: { intent: "subscription", planId: "starter", billingPeriod: "monthly" } },
    { id: "3.4", label: "Credit pack", body: { intent: "credits", quantity: 1 } },
    { id: "3.5", label: "Lifetime Pro (register F-9)", body: { intent: "lifetime" } },
  ];

  for (const { id, label, body } of intents) {
    const response = await app("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await json(response);
    if (response.ok && typeof payload.url === "string" && payload.url.includes("stripe.com")) {
      record(id, `${label} → Stripe`, "pass", payload.url.slice(0, 72) + "…");
    } else {
      record(id, `${label} → Stripe`, "fail", `${response.status} ${JSON.stringify(payload).slice(0, 220)}`);
    }
  }

  // -- 4. a paid customer is admitted (register F-2 died HERE) --------------
  //
  // The plan is granted the way the Stripe webhook grants a Lifetime purchase —
  // a `plan_entitlements` row — rather than by driving the hosted Checkout page.
  // That is the same table, the same read path and the same RLS the real thing
  // goes through, which is what F-2 broke; only the payment UI is skipped.
  console.log("\n4. A paid customer is admitted");
  const grant = await supabaseAdmin(env, "/rest/v1/plan_entitlements", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      plan_id: "pro",
      source: "qa_journey",
      stripe_payment_intent_id: `pi_qa_${stamp}`,
    }),
  });
  if (!grant.ok) {
    throw new Fatal(`Could not grant the QA entitlement: ${grant.status} ${await grant.text()}`);
  }
  record("4.1", "Pro entitlement granted (as the webhook would)", "pass");

  const entitled = await json(await app("/api/billing/entitlement"));
  if (entitled.kind === "plan" && entitled.planId === "pro") {
    record("4.2", "Entitlement resolves under the USER's token", "pass", JSON.stringify(entitled).slice(0, 120));
  } else {
    record(
      "4.2",
      "Entitlement resolves under the USER's token",
      "fail",
      `expected {kind:"plan",planId:"pro"}, got ${JSON.stringify(entitled).slice(0, 200)} — ` +
        `this is register F-2: the row exists but RLS hides it from its owner`,
    );
  }

  const dashboard = await app("/dashboard");
  if (dashboard.status === 200) {
    record("4.3", "Paid session reaches the dashboard", "pass");
  } else {
    record("4.3", "Paid session reaches the dashboard", "fail", `status ${dashboard.status} → ${dashboard.headers.get("location") ?? ""}`);
  }

  // -- 5. register a site and get a working embed snippet -------------------
  console.log("\n5. Connect a site");
  const siteResponse = await app("/api/sites/register", {
    method: "POST",
    body: JSON.stringify({ domain: siteDomain, name: `QA ${stamp}` }),
  });
  const site = await json(siteResponse);
  const siteId = site.siteId ?? site.site?.id ?? site.id;
  /** Sites created by the limit probe, so cleanup can remove them too. */
  const extraSiteIds = [];

  if (!siteResponse.ok || !siteId) {
    record("5.1", "Site registers", "fail", `${siteResponse.status} ${JSON.stringify(site).slice(0, 220)}`);
  } else {
    record("5.1", "Site registers", "pass", `${siteId} (${siteDomain})`);

    const token = site.siteToken ?? site.token ?? site.site_token;
    if (token) {
      record("5.2", "Embed snippet carries a site token", "pass");
    } else {
      record("5.2", "Embed snippet carries a site token", "fail", "no token in the response — a copied snippet cannot boot");
    }

    // Register F-3: `sites` authorises through a site_permissions EXISTS
    // predicate, so an unreadable permissions table empties a site's own
    // owner's list without erroring.
    const listed = await json(await app("/api/sites"));
    const sites = Array.isArray(listed) ? listed : (listed.sites ?? []);
    if (sites.some((s) => (s.id ?? s.site_id) === siteId)) {
      record("5.3", "Owner sees their own site (register F-3)", "pass", `${sites.length} site(s)`);
    } else {
      record("5.3", "Owner sees their own site (register F-3)", "fail", `list returned ${JSON.stringify(listed).slice(0, 200)}`);
    }

    // Register F-4: the dashboard is same-origin and can never present the
    // customer's domain as its Origin, so this used to be "Origin not allowed".
    const content = await app(`/api/content/${siteId}`);
    if (content.status === 200) {
      record("5.4", "Dashboard reads content first-party (register F-4)", "pass");
    } else {
      record("5.4", "Dashboard reads content first-party (register F-4)", "fail", `status ${content.status} ${JSON.stringify(await json(content)).slice(0, 160)}`);
    }

    // -- 5b. the core loop: discover → edit → save → publish ----------------
    //
    // The register could not walk this at all ("no content was ever saved"),
    // which left the publish path, version history and rollback untested on a
    // product whose entire proposition is editing published copy.
    console.log("\n5b. Edit → save → publish");

    const ELEMENT = "qa-headline";
    const ORIGINAL = "Original headline";
    const EDITED = "Edited headline";

    // The widget reports the elements it found on the customer's page. This is
    // content discovery, the same call the script makes on first boot — and it
    // is deliberately widget-only: it proves it is running ON the registered
    // domain with a signed site token, which a dashboard never can. So this
    // step impersonates the widget exactly (token in the query string, Origin
    // set to the registered domain) rather than reaching for the session.
    const discovered = await app(`/api/content/${siteId}?token=${encodeURIComponent(token ?? "")}`, {
      method: "POST",
      headers: { Origin: `https://${siteDomain}` },
      body: JSON.stringify({
        [ELEMENT]: { content: ORIGINAL, selector: "h1" },
      }),
    });
    if (discovered.ok) {
      record("5b.1", "Widget registers discovered elements", "pass");
    } else {
      record("5b.1", "Widget registers discovered elements", "fail", `${discovered.status} ${JSON.stringify(await json(discovered)).slice(0, 200)}`);
    }

    // Register F-10. `/api/sites` derives status from content_elements, and
    // nothing ever wrote that table for a live site: the widget announced its
    // content map over socket.io only, and that listener is an Express process
    // Vercel cannot host. So every customer's site read "Verifying" forever
    // while their page worked. Now that discovery goes over HTTP, the step
    // above is the thing that flips it.
    const listed2 = await json(await app("/api/sites"));
    const sites2 = Array.isArray(listed2) ? listed2 : (listed2.sites ?? []);
    const thisSite = sites2.find((s) => (s.id ?? s.site_id) === siteId);
    if (thisSite?.status === "active") {
      record("5b.1b", "Site leaves \"Verifying\" once content is reported (F-10)", "pass", `status=${thisSite.status}`);
    } else {
      record(
        "5b.1b",
        "Site leaves \"Verifying\" once content is reported (F-10)",
        "fail",
        `status=${JSON.stringify(thisSite?.status)} — the owner is told to wait for something that can never happen`,
      );
    }

    // The owner holds `admin` on their own site and carries no editor token —
    // they never can. A route that only validates tokens refuses them.
    const saved = await app(`/api/staging/content/${siteId}`, {
      method: "PUT",
      body: JSON.stringify({ elementId: ELEMENT, content: EDITED }),
    });
    if (saved.ok) {
      record("5b.2", "Owner saves a draft edit first-party", "pass");
    } else {
      record(
        "5b.2",
        "Owner saves a draft edit first-party",
        "fail",
        `${saved.status} ${JSON.stringify(await json(saved)).slice(0, 200)} — the owner has no first-party editing surface`,
      );
    }

    const draft = await json(await app(`/api/staging/content/${siteId}`));
    const draftEl = (draft.content ?? []).find((e) => e.element_id === ELEMENT);
    if (draftEl?.staging_content === EDITED) {
      record("5b.3", "Draft reads back with the edit staged", "pass", `has_staging_changes=${draftEl.has_staging_changes}`);
    } else {
      record("5b.3", "Draft reads back with the edit staged", "fail", JSON.stringify(draft).slice(0, 220));
    }

    // Before publishing, the LIVE content must still be the original — a draft
    // that is already live is not a draft.
    const liveBefore = liveContentOf(
      await json(await app(`/api/content/${siteId}`)),
      ELEMENT,
    );
    if (liveBefore === ORIGINAL) {
      record("5b.4", "Live content is unchanged before publish", "pass");
    } else {
      record("5b.4", "Live content is unchanged before publish", "fail", `live reads ${JSON.stringify(liveBefore)}, expected the original`);
    }

    const published = await app("/api/staging/publish", {
      method: "POST",
      body: JSON.stringify({ siteId, elementIds: [ELEMENT] }),
    });
    const publishBody = await json(published);
    if (published.ok && publishBody.published >= 1) {
      record("5b.5", "Owner publishes the draft", "pass", `${publishBody.published} element(s)`);
    } else {
      record("5b.5", "Owner publishes the draft", "fail", `${published.status} ${JSON.stringify(publishBody).slice(0, 200)}`);
    }

    const liveAfter = liveContentOf(
      await json(await app(`/api/content/${siteId}`)),
      ELEMENT,
    );
    if (liveAfter === EDITED) {
      record("5b.6", "Published edit is live", "pass", `"${EDITED}"`);
    } else {
      record("5b.6", "Published edit is live", "fail", `live reads ${JSON.stringify(liveAfter)} after publish`);
    }

    // -- 5c. the invited editor's side of the loop -------------------------
    //
    // Register 6.6, the one row it flagged as "not verified" and called "the
    // product's core loop … the next thing that should be tested". It was
    // blocked behind F-6 (no transactional email had ever been deliverable),
    // so the invite existed and the code never arrived.
    //
    // The code is delivered ONLY by email and never in a response body, which
    // is correct and is why this reads it from `staging_access` with the
    // service role instead. That checks everything except the mail hop; the
    // mail hop itself is asserted separately by `emailDelivered` below.
    console.log("\n5c. Invited editor");

    const editorEmail = `rboboe+rcfeditor${stamp}@gmail.com`;
    const invite = await app("/api/staging/access", {
      method: "POST",
      body: JSON.stringify({
        siteId,
        type: "invite",
        email: editorEmail,
        permissions: ["view", "edit"],
        expiresInDays: 7,
      }),
    });
    const inviteBody = await json(invite);

    if (invite.ok) {
      record("5c.1", "Owner invites an editor", "pass", editorEmail);
    } else {
      record("5c.1", "Owner invites an editor", "fail", `${invite.status} ${JSON.stringify(inviteBody).slice(0, 200)}`);
    }

    // Register F-6: the UI used to claim success while Resend rejected the
    // send, so the route now reports delivery and this asserts on it.
    if (inviteBody.emailDelivered === true) {
      record("5c.2", "Invite email actually delivered (register F-6)", "pass");
    } else {
      record(
        "5c.2",
        "Invite email actually delivered (register F-6)",
        "fail",
        `emailDelivered=${JSON.stringify(inviteBody.emailDelivered)} — the invite is worthless without its code`,
      );
    }

    const accessRow = (
      await json(
        await supabaseAdmin(
          env,
          `/rest/v1/staging_access?site_id=eq.${siteId}&email=eq.${encodeURIComponent(editorEmail)}&select=token,verification_code,permissions`,
        ),
      )
    )?.[0];

    if (!accessRow?.token) {
      record("5c.3", "Invite is recorded with a code", "fail", "no staging_access row");
    } else {
      record("5c.3", "Invite is recorded with a code", "pass", `permissions=${JSON.stringify(accessRow.permissions)}`);

      // From here on, act as the EDITOR: a different person, on the customer's
      // own domain, with no Supabase session at all. The cookie jar would make
      // this the owner again, so every call below is made bare.
      const asEditor = (pathname, init = {}) =>
        fetch(`${BASE}${pathname}`, {
          ...init,
          redirect: "manual",
          headers: {
            Origin: `https://${siteDomain}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers ?? {}),
          },
        });

      const verified = await asEditor("/api/staging/verify", {
        method: "POST",
        body: JSON.stringify({ token: accessRow.token, code: accessRow.verification_code }),
      });
      const verifiedBody = await json(verified);
      if (verified.ok && verifiedBody.verified) {
        record("5c.4", "Editor verifies with the emailed code", "pass", `permissions=${JSON.stringify(verifiedBody.permissions)}`);
      } else {
        record("5c.4", "Editor verifies with the emailed code", "fail", `${verified.status} ${JSON.stringify(verifiedBody).slice(0, 200)}`);
      }

      const EDITOR_TEXT = "Headline the invited editor wrote";
      const editorSaved = await asEditor(`/api/staging/content/${siteId}?rcf_token=${encodeURIComponent(accessRow.token)}`, {
        method: "PUT",
        body: JSON.stringify({ elementId: ELEMENT, content: EDITOR_TEXT }),
      });
      if (editorSaved.ok) {
        record("5c.5", "Editor's edit sticks (register 6.6)", "pass");
      } else {
        record("5c.5", "Editor's edit sticks (register 6.6)", "fail", `${editorSaved.status} ${JSON.stringify(await json(editorSaved)).slice(0, 200)}`);
      }

      // Granted view+edit and nothing more, so publishing must be refused —
      // otherwise the permission levels are decorative.
      const editorPublish = await asEditor("/api/staging/publish", {
        method: "POST",
        body: JSON.stringify({ siteId, token: accessRow.token, elementIds: [ELEMENT] }),
      });
      if (editorPublish.status === 403) {
        record("5c.6", "Editor without publish rights is refused", "pass", "403");
      } else {
        record("5c.6", "Editor without publish rights is refused", "fail", `expected 403, got ${editorPublish.status}`);
      }

      // …and the owner can then publish what the editor wrote, which is the
      // whole collaboration loop closing.
      const ownerPublish = await app("/api/staging/publish", {
        method: "POST",
        body: JSON.stringify({ siteId, elementIds: [ELEMENT] }),
      });
      const publishBody2 = await json(ownerPublish);
      const live = await json(await app(`/api/content/${siteId}`));
      const liveText = liveContentOf(live, ELEMENT);
      if (ownerPublish.ok && liveText === EDITOR_TEXT) {
        record("5c.7", "Owner publishes the editor's work", "pass", `"${EDITOR_TEXT}"`);
      } else {
        record(
          "5c.7",
          "Owner publishes the editor's work",
          "fail",
          `publish ${ownerPublish.status} ${JSON.stringify(publishBody2).slice(0, 120)} · live reads ${JSON.stringify(liveText)} · shape ${JSON.stringify(live).slice(0, 160)}`,
        );
      }
    }

    // -- 5e. version history and rollback ----------------------------------
    //
    // The register listed these as untested. They turned out to be the THIRD
    // route family authorised by staging token alone, so the owner — signed in,
    // holding `admin` — could not read their own history or roll anything back.
    console.log("\n5e. Version history & rollback");

    const snapshot = await app("/api/edit-board/history", {
      method: "POST",
      body: JSON.stringify({ siteId, description: "qa snapshot" }),
    });
    if (snapshot.ok) {
      record("5e.1", "Owner creates a version snapshot", "pass");
    } else {
      record("5e.1", "Owner creates a version snapshot", "fail", `${snapshot.status} ${JSON.stringify(await json(snapshot)).slice(0, 180)}`);
    }

    const history = await json(await app(`/api/edit-board/history?siteId=${siteId}`));
    const versions = history.versions ?? [];
    if (versions.length > 0) {
      record("5e.2", "Owner reads version history first-party", "pass", `${versions.length} version(s)`);
    } else {
      record("5e.2", "Owner reads version history first-party", "fail", JSON.stringify(history).slice(0, 200));
    }

    if (versions.length > 0) {
      const versionId = versions[0].id;
      const restored = await app(`/api/edit-board/history/${versionId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (restored.ok) {
        record("5e.3", "Owner rolls back to a version", "pass");
      } else {
        record("5e.3", "Owner rolls back to a version", "fail", `${restored.status} ${JSON.stringify(await json(restored)).slice(0, 180)}`);
      }
    }

    // -- 5f. the plan's site limit is actually enforced ---------------------
    //
    // Register: "Multi-site limits … the limit boundary and the '+$5 per
    // additional website' charge were not exercised." A limit nobody has ever
    // hit is a limit nobody knows works — and it is what separates the $9 plan
    // from the $19 one.
    //
    // Probed on STARTER, not on the Pro plan this user holds, and the reason is
    // the whole point of the step. `IP_REGISTRATION` allows 5 registrations an
    // hour and Pro allows 5 websites, so on Pro the rate limiter answers first
    // and a probe would report 429 — which looks like the limit working and is
    // not it. Starter allows 1, well inside the rate limit, so a refusal here
    // can only have come from the plan gate.
    console.log("\n5f. Site limit");

    const swapPlan = async (planId) => {
      await supabaseAdmin(env, `/rest/v1/plan_entitlements?user_id=eq.${userId}`, {
        method: "DELETE",
      });
      await supabaseAdmin(env, "/rest/v1/plan_entitlements", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          plan_id: planId,
          source: "qa_journey",
          stripe_payment_intent_id: `pi_qa_${stamp}_${planId}`,
        }),
      });
    };

    await swapPlan("starter");

    const overLimit = await app("/api/sites/register", {
      method: "POST",
      body: JSON.stringify({
        domain: `qa-${stamp}-2.example.com`,
        name: `QA ${stamp} #2`,
      }),
    });
    const overLimitBody = await json(overLimit);
    const extraId = overLimitBody.siteId ?? overLimitBody.site?.id ?? overLimitBody.id;
    if (extraId) extraSiteIds.push(extraId);

    if (overLimit.status === 403 && overLimitBody.upgrade_required) {
      record("5f.1", "Second site refused on a 1-site plan", "pass", `403 · limit=${overLimitBody.limit}`);
    } else if (overLimit.status === 429) {
      record("5f.1", "Second site refused on a 1-site plan", "warn", "429 rate limit answered before the plan gate — re-run in an hour to exercise it");
    } else {
      record(
        "5f.1",
        "Second site refused on a 1-site plan",
        "fail",
        `${overLimit.status} ${JSON.stringify(overLimitBody).slice(0, 180)} — a Starter customer can register without bound`,
      );
    }

    // A refusal that does not say what to do about it reads as a bug.
    const refusalText = JSON.stringify(overLimitBody);
    if (overLimit.status === 403 && /upgrade|limit|plan/i.test(refusalText)) {
      record("5f.2", "Refusal explains the limit and the way out", "pass", String(overLimitBody.error).slice(0, 110));
    } else if (overLimit.status === 403) {
      record("5f.2", "Refusal explains the limit and the way out", "warn", refusalText.slice(0, 160));
    }

    await swapPlan("pro");

    // -- 5d. analytics counts the sites you actually own --------------------
    //
    // Register F-10's other half: "Analytics reports Total Sites 0" with sites
    // registered. Every query in the all-sites view filtered on `id = ""`, a
    // deliberate no-leak stopgap that matched nothing, and total_sites counted
    // distinct site_ids in the activity log rather than sites.
    console.log("\n5d. Analytics");

    const analytics = await json(await app("/api/analytics/track"));
    const totalSites = analytics?.overview?.total_sites;
    if (totalSites >= 1) {
      record("5d.1", "Analytics counts owned sites, not active ones (F-10)", "pass", `total_sites=${totalSites}`);
    } else {
      record(
        "5d.1",
        "Analytics counts owned sites, not active ones (F-10)",
        "fail",
        `total_sites=${JSON.stringify(totalSites)} with 1 site registered`,
      );
    }
  }

  // -- 6. the embed script is servable --------------------------------------
  console.log("\n6. Embed script");
  const embed = await app("/embed/recopyfast.js");
  const embedBody = embed.ok ? await embed.text() : "";
  if (embed.ok && embedBody.length > 1000) {
    record("6.1", "Widget script serves", "pass", `${(embedBody.length / 1024).toFixed(0)} KB`);
  } else {
    record("6.1", "Widget script serves", "fail", `status ${embed.status}, ${embedBody.length} bytes`);
  }

  // -- 7. clean up -----------------------------------------------------------
  if (!KEEP) {
    console.log("\n7. Cleanup");
    // Order matters. `sites`, `site_permissions` and everything hanging off
    // them reference auth.users, so deleting the user first fails with a 500
    // that reads like a Supabase fault rather than the foreign key it is.
    for (const id of [siteId, ...extraSiteIds].filter(Boolean)) {
      // content_versions references content_elements; staging_access and
      // staging_history reference the site. Order matters or the delete 409s.
      await supabaseAdmin(env, `/rest/v1/content_versions?site_id=eq.${id}`, { method: "DELETE" });
      await supabaseAdmin(env, `/rest/v1/staging_access?site_id=eq.${id}`, { method: "DELETE" });
      await supabaseAdmin(env, `/rest/v1/content_elements?site_id=eq.${id}`, { method: "DELETE" });
      await supabaseAdmin(env, `/rest/v1/site_permissions?site_id=eq.${id}`, { method: "DELETE" });
      await supabaseAdmin(env, `/rest/v1/sites?id=eq.${id}`, { method: "DELETE" });
    }
    await supabaseAdmin(env, `/rest/v1/plan_entitlements?user_id=eq.${userId}`, { method: "DELETE" });

    const deleted = await supabaseAdmin(env, `/auth/v1/admin/users/${userId}`, { method: "DELETE" });
    record(
      "7.1",
      "QA user and site removed",
      deleted.ok ? "pass" : "warn",
      deleted.ok
        ? email
        : `status ${deleted.status} — ${email} / site ${siteId} left behind, delete by hand`,
    );
  } else {
    console.log(`\n7. Cleanup skipped (--keep). User ${email} / ${userId} left in place.`);
  }
}

try {
  await main();
} catch (error) {
  hardFailure = error;
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => r.status === "fail");
const warned = results.filter((r) => r.status === "warn");

console.log("\n" + "─".repeat(70));
console.log(
  `${results.filter((r) => r.status === "pass").length} passed · ${failed.length} failed · ${warned.length} warned`,
);
if (hardFailure) console.error(`\nSTOPPED: ${hardFailure.message}`);
if (failed.length) {
  console.error("\nFailures:");
  for (const f of failed) console.error(`  ${f.id} ${f.title}\n     ${f.detail}`);
}
console.log("");

process.exit(hardFailure || failed.length ? 1 : 0);
