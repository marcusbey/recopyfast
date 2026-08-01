/**
 * Writes into the public `assets` bucket.
 *
 * All writes go through the service-role client, which bypasses RLS. That is
 * deliberate: the storage policies grant *no* insert/update/delete to anon or
 * authenticated roles (see the storage bucket migration), so this module is the
 * only path by which an object can be created. Authorisation therefore happens
 * once, in the route handler, against the site token — there is no second,
 * weaker door into the bucket for a client to find.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { ASSETS_BUCKET, buildAssetKey } from "./assets";

/**
 * Objects are immutable: the key contains 128 bits of randomness and is never
 * reused, so a stored image can never change under a URL already embedded in a
 * customer's page. A one-year immutable cache is therefore safe and keeps the
 * CDN from revalidating on every visitor.
 */
const CACHE_CONTROL_SECONDS = 31_536_000;

export interface UploadedAsset {
  url: string;
  key: string;
}

export type UploadResult =
  | { ok: true; value: UploadedAsset }
  | { ok: false; error: string };

export interface UploadAssetOptions {
  /** Owning site. Already authenticated by the caller. */
  siteId: string;
  data: Buffer;
  /** Derived from sniffed bytes, never from the client's Content-Type. */
  contentType: string;
  extension: string;
}

export async function uploadSiteAsset(
  options: UploadAssetOptions,
): Promise<UploadResult> {
  const { siteId, data, contentType, extension } = options;
  const key = buildAssetKey(siteId, extension);

  const supabase = createServiceRoleClient();

  const { error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(key, data, {
      contentType,
      cacheControl: String(CACHE_CONTROL_SECONDS),
      // A random key should never collide. If it somehow does, failing is
      // correct: overwriting would destroy an image a customer's page already
      // references.
      upsert: false,
    });

  if (error) {
    // Surface the storage failure to the server log; the caller returns a
    // generic message so bucket internals are not leaked to the client.
    console.error("Asset upload failed:", error.message);
    return { ok: false, error: "Failed to store image" };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(key);

  return { ok: true, value: { url: publicUrl, key } };
}
