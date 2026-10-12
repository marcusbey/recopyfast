-- Retire s62's unused content revision rotation without removing its private
-- schema contract.
--
-- 20261005000000 attached an AFTER-statement trigger to every content_elements
-- mutation. The content write already held child-row locks when that trigger
-- took the parent sites row. The product deletes a site in the opposite order:
-- DELETE sites first locks the parent, then ON DELETE CASCADE reaches the child.
-- A draft save racing that delete reproduced SQLSTATE 40P01 on PostgreSQL 17.
--
-- ADR 046 superseded the Redis reader this mechanism was built for. Keeping an
-- unconsumed parent-row write would therefore preserve the deadlock only to
-- rotate a value no runtime reads. Drop the complete write path, while leaving
-- the column and its web-role denials in place for schema compatibility. A
-- future cache must introduce and review a new lock order rather than restoring
-- these triggers piecemeal.

DROP TRIGGER IF EXISTS rotate_public_content_revision_insert
  ON public.content_elements;
DROP TRIGGER IF EXISTS rotate_public_content_revision_update
  ON public.content_elements;
DROP TRIGGER IF EXISTS rotate_public_content_revision_delete
  ON public.content_elements;
DROP TRIGGER IF EXISTS rotate_public_content_revision_truncate
  ON public.content_elements;

-- Revoke before dropping even though these functions are about to disappear.
-- This keeps the migration safe if a failure stops it between statements: no
-- retired coordination helper is left callable by a role that once had it.
-- Resolve each fixed signature first so retrying after an uncertain connection
-- result also converges when some or all functions were already removed.
DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.rotate_public_content_revision_after_insert()',
    'public.rotate_public_content_revision_after_update()',
    'public.rotate_public_content_revision_after_delete()',
    'public.rotate_public_content_revision_after_truncate()',
    'public.rotate_public_content_revisions(uuid[])'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      EXECUTE
        'REVOKE ALL ON FUNCTION ' || v_signature ||
        ' FROM PUBLIC, anon, authenticated, service_role';
      EXECUTE 'DROP FUNCTION ' || v_signature;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.sites.public_content_revision IS
  'Reserved server-only compatibility token. No current runtime consumes or rotates it; any future cache must introduce a reviewed lock order before reuse.';

-- s38 removed table-level web access and s62 explicitly denied this column.
-- Repeat the column decision here because the column survives the mechanism:
-- a later grant repair must not mistake "reserved" for customer metadata.
REVOKE SELECT (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE INSERT (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
REVOKE REFERENCES (public_content_revision)
  ON TABLE public.sites FROM PUBLIC, anon, authenticated;
