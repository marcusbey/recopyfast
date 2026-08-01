-- ========================================
-- Storage: public `assets` bucket for CMS image uploads
-- ========================================
-- There is no storage bucket anywhere in this project today:
--   grep 'storage.buckets\|storage.objects' supabase/migrations/*.sql → nothing
-- and GET /api/health has consequently been reporting
--   "storage": { "status": "error", "error": "Bucket not found" }
-- because src/app/api/health/route.ts:88 probes getBucket("assets"). The bucket
-- id below is therefore fixed as 'assets' to match that existing probe.
--
-- Without a bucket, the widget's "Upload New Image" control had nowhere to put
-- bytes, so it inlined a FileReader data URI into the element's content value.
-- That put ~2.7 MB of base64 into content_elements.current_content for a 2 MB
-- photo, and the log_content_change() trigger then copied the blob into
-- content_history on every later edit of that element.
--
-- PUBLIC-READ, NOT SIGNED URLS
-- ---------------------------
-- The bucket is public. Signed URLs were considered and rejected:
--
--   1. The returned URL is persisted as the element's content value and served
--      to anonymous visitors from the customer's own site. A signed URL expires;
--      the stored content value does not. Every published image would 404 the
--      moment its signature aged out, silently breaking live customer pages.
--   2. A per-request signature makes the URL unique per view, which defeats
--      CDN and browser caching for assets that are, by design, immutable.
--
-- Confidentiality is not the property being protected here — these images are
-- embedded in public web pages, so anyone who can see the page can see them.
-- The properties that *do* matter are integrity and tenant isolation, and those
-- come from the write path, not from read secrecy:
--
--   • No role except service_role may write. The policies below grant SELECT
--     only; there is deliberately no INSERT/UPDATE/DELETE policy for anon or
--     authenticated, and with RLS enabled on storage.objects the absence of a
--     policy is a denial. Every write funnels through
--     POST /api/upload/image, which authenticates the site token first.
--   • Object keys are `sites/<siteId>/<yyyy>/<mm>/<128-bit random>.<ext>`
--     (src/lib/storage/assets.ts). The site prefix comes from an authenticated,
--     UUID-validated siteId, so one site's objects can never be written into
--     another's prefix, and the random component makes keys unguessable.
--   • Uploads use upsert:false, so an existing object can never be replaced.
-- ========================================

-- ============================================================
-- 1. The bucket
-- ============================================================
-- Guarded on the storage schema existing: `supabase db reset` and a hosted
-- project both have it, but a bare Postgres (used for migration syntax checks
-- in CI) does not. Skipping is correct there — there is no storage to configure.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present; skipping assets bucket creation';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'assets',
    'assets',
    TRUE,
    -- 4 MB. Matches MAX_UPLOAD_BYTES in src/app/api/upload/image/route.ts, which
    -- is itself set below Vercel's 4.5 MB serverless request-body ceiling so the
    -- rejection is ours and carries a JSON body. Enforcing it here as well means
    -- the limit still holds if a future caller reaches storage another way.
    4194304,
    -- Second, storage-tier enforcement of the format allowlist. The endpoint
    -- already sets contentType from sniffed bytes; this makes the bucket refuse
    -- anything else regardless of caller. SVG is absent by design — see the
    -- rejection rationale in src/app/api/upload/image/route.ts.
    ARRAY[
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif'
    ]::TEXT[]
  )
  ON CONFLICT (id) DO UPDATE
    SET public             = EXCLUDED.public,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END
$$;

-- ============================================================
-- 2. Bucket metadata visibility
-- ============================================================
-- src/app/api/health/route.ts calls getBucket("assets") through the *anon* SSR
-- client. Reading a bucket row is governed by RLS on storage.buckets, and
-- Supabase ships no policy there, so an anonymous caller is told "Bucket not
-- found" even when the bucket exists and is public. That is precisely the error
-- the health endpoint has been reporting — a visibility result, not a missing
-- bucket. Verified directly: service_role getBucket returns public=true while
-- anon getBucket returns "Bucket not found".
--
-- Exposing this one row leaks nothing: it says a public bucket named 'assets'
-- accepts images up to 4 MB, which is already observable from any image URL
-- embedded in a customer's page.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present; skipping bucket visibility policy';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Public can see the assets bucket" ON storage.buckets;
  CREATE POLICY "Public can see the assets bucket"
    ON storage.buckets
    FOR SELECT
    TO public
    USING (id = 'assets');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'insufficient privilege to manage storage.buckets policies; configure them in the Supabase dashboard';
END
$$;

-- ============================================================
-- 3. Object policies — deliberately none
-- ============================================================
-- No policy of any kind is created on storage.objects, and that is the whole
-- point. RLS is enabled there, so with no policy every role except service_role
-- is denied every verb.
--
-- READS still work. A public bucket is served by storage-api's
-- /storage/v1/object/public/<bucket>/<key> path, which does not consult
-- storage.objects RLS. Confirmed with an unauthenticated request carrying no
-- API key at all: HTTP 200, image/png, 2809 bytes.
--
-- The tempting policy here would be
--   CREATE POLICY ... ON storage.objects FOR SELECT TO public
--     USING (bucket_id = 'assets');
-- and it would be a mistake. SELECT on storage.objects is what powers the
-- *list* operation, so that policy would let any anonymous caller enumerate
-- every object in the bucket — walking `sites/<siteId>/` prefixes to inventory
-- each tenant's images. The 128-bit random object names exist precisely to make
-- images unguessable; granting list access would hand out the index and throw
-- that property away for no gain, since downloads already work without it.
--
-- WRITES are denied for the same structural reason: anon and authenticated get
-- no INSERT/UPDATE/DELETE, so the only writer is service_role, reached solely
-- through POST /api/upload/image after the site token has been verified. There
-- is no second, weaker door into the bucket.
--
-- Any such grants left over from an earlier attempt are removed so re-running
-- this migration converges on exactly that state.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present; skipping assets object policy cleanup';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Public read access to assets"        ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated write access to assets"  ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated update access to assets" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated delete access to assets" ON storage.objects;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'insufficient privilege to manage storage.objects policies; configure them in the Supabase dashboard';
END
$$;
