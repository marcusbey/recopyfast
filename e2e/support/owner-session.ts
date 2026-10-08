import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { deleteCapturedSiteFixture } from "./local-supabase";

/**
 * A signed-in site owner for the layout harness (s66a).
 *
 * Before s66a no e2e spec rendered a single authenticated dashboard page:
 * `dashboard.spec.ts` only proves the redirects to /login. The owner's
 * screenshot of the site-registered panel (a 2,524 px grid column inside a
 * 588 px dialog) therefore shipped with every unit test green, because jsdom
 * computes no layout. This fixture exists so a real browser can measure the
 * real panels.
 *
 * Everything is a throwaway on the disposable local stack, gated by
 * `createLocalServiceRoleClient` before this file is ever reached:
 * - the owner is `e2e-layout-<uuid>@example.com`, never a real address;
 * - the site's domain ends in `.invalid` and its `api_key` is a fake;
 * - the Pro grant is `source: "e2e"`, the same shape `share-edit-publish`
 *   seeds, because a dashboard page without an entitlement redirects to
 *   checkout and would measure the wrong screen.
 *
 * Cleanup is exact, like the other mutating specs: the captured site id goes
 * through `deleteCapturedSiteFixture`, and deleting the user cascades its
 * `site_permissions` and `plan_entitlements` rows.
 */
export interface LayoutOwnerFixture {
  readonly siteId: string;
  readonly email: string;
  ownerId: string | null;
}

export function createLayoutOwnerFixture(): LayoutOwnerFixture {
  const runId = randomUUID();
  return {
    siteId: randomUUID(),
    email: `e2e-layout-${runId}@example.com`,
    ownerId: null,
  };
}

export async function seedLayoutOwner(
  supabase: SupabaseClient,
  fixture: LayoutOwnerFixture,
): Promise<void> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: fixture.email,
    email_confirm: true,
  });
  if (error) throw error;
  if (!data.user) throw new Error("createUser returned no layout owner.");
  fixture.ownerId = data.user.id;

  const { error: siteError } = await supabase.from("sites").insert({
    id: fixture.siteId,
    domain: `e2e-layout-${fixture.siteId}.invalid`,
    name: "E2E layout site",
    api_key: `e2e_layout_key_${randomUUID()}`,
  });
  if (siteError) throw siteError;

  const { error: permissionError } = await supabase
    .from("site_permissions")
    .insert({
      site_id: fixture.siteId,
      user_id: fixture.ownerId,
      permission: "admin",
    });
  if (permissionError) throw permissionError;

  const { error: planError } = await supabase
    .from("plan_entitlements")
    .insert({ user_id: fixture.ownerId, plan_id: "pro", source: "e2e" });
  if (planError) throw planError;
}

export async function deleteLayoutOwner(
  supabase: SupabaseClient,
  fixture: LayoutOwnerFixture,
): Promise<void> {
  try {
    await deleteCapturedSiteFixture(supabase, fixture.siteId);
  } finally {
    if (fixture.ownerId) {
      const { error } = await supabase.auth.admin.deleteUser(fixture.ownerId);
      if (error) throw error;
      fixture.ownerId = null;
    }
  }
}

/**
 * Signs the owner in through the product's own email-link route.
 *
 * No new auth code and no cookie forging: the admin API mints the same
 * one-time token hash a magic-link email carries, and `/auth/confirm` verifies
 * it exactly as it would for a customer opening that email (`magiclink` is in
 * its `ALLOWED_OTP_TYPES`). If that route breaks, this harness breaks with it,
 * which is the point.
 */
export async function signInAsLayoutOwner(
  page: Page,
  supabase: SupabaseClient,
  fixture: LayoutOwnerFixture,
  next = "/dashboard/sites",
): Promise<void> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: fixture.email,
  });
  if (error) throw error;

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed token.");

  const confirmUrl =
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}` +
    `&type=magiclink&next=${encodeURIComponent(next)}`;
  await page.goto(confirmUrl);
  await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe(next);
}
