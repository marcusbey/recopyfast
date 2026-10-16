-- ADR070: context is optional, private attribution, not the signup/payment ledger.
-- All context mutations share this short transaction lock. Future delivery claims
-- must acquire the same lock before testing eligibility; never retain it over HTTP.
CREATE TABLE public.analytics_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_hash text CHECK (capability_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text CHECK (client_id ~ '^[0-9]{1,32}\.[0-9]{1,32}$'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consent_basis text NOT NULL CHECK (consent_basis IN ('explicit','regional')),
  consent_version integer NOT NULL DEFAULT 1 CHECK (consent_version=1),
  consent_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  bound_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > captured_at AND expires_at <= captured_at + interval '30 days' AND expires_at <= consent_expires_at),
  CHECK (consent_at <= captured_at),
  CHECK ((user_id IS NULL) = (bound_at IS NULL)),
  CHECK ((revoked_at IS NULL AND client_id IS NOT NULL AND capability_hash IS NOT NULL) OR (revoked_at IS NOT NULL AND client_id IS NULL AND capability_hash IS NULL))
);
ALTER TABLE public.analytics_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_contexts FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.analytics_contexts TO service_role;
CREATE POLICY analytics_contexts_service ON public.analytics_contexts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX analytics_contexts_capability ON public.analytics_contexts(capability_hash) WHERE capability_hash IS NOT NULL;
CREATE INDEX analytics_contexts_user_capture ON public.analytics_contexts(user_id,captured_at DESC,id DESC) WHERE revoked_at IS NULL;
CREATE INDEX analytics_contexts_expiry ON public.analytics_contexts(expires_at);
CREATE INDEX analytics_contexts_revoked ON public.analytics_contexts(revoked_at) WHERE revoked_at IS NOT NULL;

CREATE FUNCTION public.capture_analytics_context(p_hash text,p_client_id text,p_basis text,p_consent_expires_at timestamptz,p_existing boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_id uuid; v_user uuid; v_bound timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 IF p_consent_expires_at IS NULL OR p_consent_expires_at<=v_now OR p_existing IS NULL THEN RETURN NULL; END IF;
 IF p_existing THEN
   SELECT user_id,bound_at INTO v_user,v_bound FROM public.analytics_contexts
    WHERE capability_hash=p_hash AND revoked_at IS NULL AND expires_at>v_now ORDER BY captured_at DESC,id DESC LIMIT 1;
   IF NOT FOUND THEN RETURN NULL; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM public.analytics_contexts WHERE capability_hash=p_hash) THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO public.analytics_contexts(capability_hash,client_id,user_id,bound_at,captured_at,consent_at,consent_basis,consent_expires_at,expires_at)
 VALUES(p_hash,p_client_id,v_user,v_bound,v_now,v_now,p_basis,p_consent_expires_at,least(v_now+interval '30 days',p_consent_expires_at)) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.bind_analytics_context(p_hash text,p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer; v_now timestamptz:=clock_timestamp();
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 IF p_user_id IS NULL THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM public.analytics_contexts WHERE capability_hash=p_hash AND user_id IS NOT NULL AND user_id<>p_user_id) THEN RETURN 0; END IF;
 UPDATE public.analytics_contexts SET user_id=p_user_id,bound_at=v_now WHERE capability_hash=p_hash AND user_id IS NULL AND revoked_at IS NULL AND expires_at>v_now;
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

CREATE FUNCTION public.revoke_analytics_context(p_hash text,p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 UPDATE public.analytics_contexts SET revoked_at=clock_timestamp(),client_id=NULL,capability_hash=NULL
 WHERE revoked_at IS NULL AND (capability_hash=p_hash OR (p_user_id IS NOT NULL AND user_id=p_user_id));
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

-- s111 must freeze this selection in its source disposition, then recheck the
-- selected row under advisory lock710110 at claim. A capability permits signup
-- binding after confirmation; payments without it require binding before occurrence.
CREATE FUNCTION public.eligible_analytics_context(p_user_id uuid,p_occurred_at timestamptz,p_signup_hash text DEFAULT NULL)
RETURNS SETOF public.analytics_contexts LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT c.* FROM public.analytics_contexts c WHERE c.user_id=p_user_id
 AND c.revoked_at IS NULL AND c.expires_at>statement_timestamp() AND c.expires_at>p_occurred_at
 AND c.captured_at<=p_occurred_at AND c.consent_at<=p_occurred_at
 AND p_occurred_at<=statement_timestamp()
 AND ((p_signup_hash IS NULL AND c.bound_at<=p_occurred_at) OR (p_signup_hash IS NOT NULL AND c.capability_hash=p_signup_hash))
 ORDER BY c.captured_at DESC,c.id DESC LIMIT 1;
$$;

CREATE FUNCTION public.cleanup_analytics_contexts(p_limit integer DEFAULT 1000)
RETURNS TABLE(deleted bigint,overdue bigint) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_limit<1 OR p_limit>1000 OR p_limit IS NULL THEN RAISE EXCEPTION 'Invalid cleanup limit' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(710110);
 WITH victims AS (SELECT id FROM public.analytics_contexts WHERE expires_at<=clock_timestamp() OR revoked_at IS NOT NULL ORDER BY expires_at LIMIT p_limit),
 removed AS (DELETE FROM public.analytics_contexts WHERE id IN(SELECT id FROM victims) RETURNING id)
 SELECT count(*) INTO deleted FROM removed;
 SELECT count(*) INTO overdue FROM public.analytics_contexts WHERE expires_at<clock_timestamp()-interval '10 minutes' OR revoked_at<clock_timestamp()-interval '10 minutes';
 RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.capture_analytics_context(text,text,text,timestamptz,boolean),public.bind_analytics_context(text,uuid),public.revoke_analytics_context(text,uuid),public.eligible_analytics_context(uuid,timestamptz,text),public.cleanup_analytics_contexts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_analytics_context(text,text,text,timestamptz,boolean),public.bind_analytics_context(text,uuid),public.revoke_analytics_context(text,uuid),public.eligible_analytics_context(uuid,timestamptz,text),public.cleanup_analytics_contexts(integer) TO service_role;
