import { expect, test } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createLocalServiceRoleClient } from "./support/local-supabase";

/** Real disposable GoTrue + product HTTP routes + outbox; never a human OTP. */
test("verified signup freezes its browser once and later magic-link login does not duplicate", async ({
  context,
  page,
}) => {
  const db = createLocalServiceRoleClient("RUN_RECOPYFAST_CORE_E2E");
  expect(process.env.GA4_MP_ENABLED).not.toBe("1");
  const email = `e2e-analytics-${randomUUID()}@example.com`;
  const capability = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(capability).digest("hex");
  let accountId: string | undefined;
  let contextId: string | undefined;
  const google: string[] = [];
  await context.route(
    /https:\/\/.*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//,
    async (route) => {
      google.push(route.request().url());
      await route.fulfill({ status: 204, body: "" });
    },
  );
  try {
    // Public capture itself is exercised separately. Seed one owned eligible
    // context before confirmation, then present that exact browser capability
    // to the real route. Never search the account's other contexts as a shortcut.
    const captured = await db.rpc("capture_analytics_context", {
      p_hash: hash,
      p_client_id: "111.222",
      p_basis: "regional",
      p_consent_expires_at: new Date(Date.now() + 86400000).toISOString(),
      p_existing: false,
    });
    if (captured.error) throw new Error("Fixture context unavailable");
    contextId = captured.data;
    const signup = await db.auth.admin.generateLink({
      type: "signup",
      email,
      password: randomUUID(),
    });
    if (
      signup.error ||
      !signup.data.user ||
      !signup.data.properties?.hashed_token
    )
      throw new Error("Fixture signup token unavailable");
    accountId = signup.data.user.id;
    expect(signup.data.user.email_confirmed_at).toBeFalsy();
    const response = await context.request.get(
      `/auth/confirm?type=signup&token_hash=${encodeURIComponent(signup.data.properties.hashed_token)}&next=/terms`,
      {
        maxRedirects: 0,
        headers: {
          cookie: `__Host-rcf_analytics_context=${capability}`,
          "x-vercel-ip-country": "US",
        },
      },
    );
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/terms$/);
    const first = await db
      .from("analytics_delivery_events")
      .select("id,state,context_id,frozen_context_id,occurred_at")
      .eq("user_id", accountId);
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    expect(first.data![0]).toMatchObject({
      state: "pending",
      context_id: contextId,
      frozen_context_id: contextId,
    });
    const confirmed = await db.auth.admin.getUserById(accountId);
    if (confirmed.error || !confirmed.data.user?.email_confirmed_at)
      throw new Error("Fixture account did not confirm");
    expect(Date.parse(first.data![0].occurred_at)).toBe(
      Date.parse(confirmed.data.user.email_confirmed_at),
    );
    const repeat = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (repeat.error || !repeat.data.properties?.hashed_token)
      throw new Error("Fixture login token unavailable");
    const again = await context.request.get(
      `/auth/confirm?type=magiclink&token_hash=${encodeURIComponent(repeat.data.properties.hashed_token)}&next=/terms`,
      {
        maxRedirects: 0,
        headers: {
          cookie: `__Host-rcf_analytics_context=${capability}`,
          "x-vercel-ip-country": "US",
        },
      },
    );
    expect(again.status()).toBe(307);
    const after = await db
      .from("analytics_delivery_events")
      .select("id,state,context_id,frozen_context_id,occurred_at")
      .eq("user_id", accountId);
    expect(after.error).toBeNull();
    expect(after.data).toEqual(first.data);
    await page.goto("/login");
    expect(
      await page
        .locator(
          'script[src*="googletagmanager"],script[src*="google-analytics"]',
        )
        .count(),
    ).toBe(0);
    expect(google).toEqual([]);
  } finally {
    if (accountId) {
      const deleted = await db.auth.admin.deleteUser(accountId);
      if (deleted.error) throw new Error("Fixture account cleanup failed");
    }
    if (contextId) {
      const deleted = await db
        .from("analytics_contexts")
        .delete()
        .eq("id", contextId);
      if (deleted.error) throw new Error("Fixture context cleanup failed");
    }
  }
});
