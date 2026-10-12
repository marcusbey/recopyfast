DO $migration$ BEGIN
-- ADR071: freeze baseline and activation under the same Auth write lock. Auth
-- confirmation timestamps can be reset by admin reconfirmation; cutoff alone
-- is not a once-per-account authority. This is not an Auth trigger or writer.
LOCK TABLE auth.users IN SHARE MODE;
CREATE TABLE public.analytics_delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind='signup'),
 source_key text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 context_id uuid REFERENCES public.analytics_contexts(id) ON DELETE SET NULL,
 frozen_context_id uuid,
 occurred_at timestamptz NOT NULL,
 payload jsonb CHECK(payload IS NULL OR payload='{"method":"email"}'::jsonb),
 state text NOT NULL CHECK(state IN('pending','sending','accepted_http','suppressed','invalid','uncertain','expired')),
 reason text NOT NULL CHECK(reason IN('eligible','preexisting_confirmed','initial_confirmation_unproven','context_unavailable','before_activation','event_expired','context_revoked_or_expired','http_2xx','http_non_2xx','transport_error','invalid_source','dispatch_disabled','claim_expired')),
 claim_token uuid,
 claimed_at timestamptz,
 finalized_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_key='signup:'||user_id::text),
 CHECK(context_id IS NULL OR context_id=frozen_context_id),
 CHECK((state IN('pending','sending') AND payload IS NOT NULL AND frozen_context_id IS NOT NULL) OR (state NOT IN('pending','sending') AND payload IS NULL)),
 CHECK((state='sending' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL) OR state<>'sending')
);
ALTER TABLE public.analytics_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_delivery_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.analytics_delivery_events TO service_role;
CREATE POLICY analytics_delivery_service ON public.analytics_delivery_events FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX analytics_delivery_due ON public.analytics_delivery_events(created_at,id) WHERE state='pending';
CREATE INDEX analytics_delivery_claimed ON public.analytics_delivery_events(claimed_at) WHERE state='sending';
CREATE INDEX analytics_delivery_user ON public.analytics_delivery_events(user_id);
-- A literal immutable timestamp function avoids a second mutable configuration
-- table. Baseline rows and this value commit together, or neither does.
DO $$ BEGIN
 EXECUTE format('CREATE FUNCTION public.analytics_signup_activation() RETURNS timestamptz LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='''' AS %L',
 'SELECT '||quote_literal(clock_timestamp())||'::timestamptz');
END $$;
INSERT INTO public.analytics_delivery_events(kind,source_key,user_id,occurred_at,state,reason)
 SELECT 'signup','signup:'||id::text,id,email_confirmed_at,'suppressed','preexisting_confirmed'
 FROM auth.users WHERE email_confirmed_at IS NOT NULL;

-- The verified auth route is the only application caller. SECURITY DEFINER is
-- necessary solely to read auth.users confirmation, which web roles cannot read;
-- no caller-supplied occurrence or account metadata can replace that source.
CREATE FUNCTION public.freeze_analytics_signup(p_user_id uuid,p_hash text,p_proven boolean,p_consent text)
RETURNS TABLE(id uuid,state text,reason text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_occurred timestamptz; v_context uuid; v_id uuid; v_state text; v_reason text;
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 IF p_proven IS NULL OR p_consent IS NULL OR p_consent NOT IN('eligible','denied','ineligible') THEN RAISE EXCEPTION 'Invalid signup disposition' USING ERRCODE='22023'; END IF;
 SELECT u.email_confirmed_at INTO v_occurred FROM auth.users u WHERE u.id=p_user_id FOR KEY SHARE;
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid,'account_missing'::text,'account_missing'::text; RETURN; END IF;
 IF v_occurred IS NULL THEN RETURN QUERY SELECT NULL::uuid,'unconfirmed'::text,'unconfirmed'::text; RETURN; END IF;
 -- Returning sign-ins may bind fresh context for future real payments, but may
 -- never replace this signup's frozen selection or its absent disposition.
 IF p_consent='denied' THEN PERFORM public.revoke_analytics_context(p_hash,p_user_id);
 ELSIF p_consent='eligible' AND p_hash IS NOT NULL THEN PERFORM public.bind_analytics_context(p_hash,p_user_id); END IF;
 RETURN QUERY SELECT e.id,e.state,e.reason FROM public.analytics_delivery_events e WHERE e.source_key='signup:'||p_user_id::text;
 IF FOUND THEN RETURN; END IF;
 v_state:='suppressed'; v_reason:='initial_confirmation_unproven';
 IF p_proven THEN
   IF v_occurred<public.analytics_signup_activation() THEN v_reason:='before_activation';
   ELSIF v_occurred>clock_timestamp() OR v_occurred<clock_timestamp()-interval '72 hours' THEN v_state:='expired'; v_reason:='event_expired';
   ELSE
     IF p_consent='eligible' AND p_hash IS NOT NULL THEN
       SELECT c.id INTO v_context FROM public.eligible_analytics_context(p_user_id,v_occurred,p_hash) c;
     END IF;
     IF v_context IS NULL THEN v_reason:='context_unavailable';
     ELSE v_state:='pending'; v_reason:='eligible'; END IF;
   END IF;
 END IF;
 INSERT INTO public.analytics_delivery_events(kind,source_key,user_id,context_id,frozen_context_id,occurred_at,payload,state,reason)
 VALUES('signup','signup:'||p_user_id::text,p_user_id,v_context,v_context,v_occurred,CASE WHEN v_state='pending' THEN '{"method":"email"}'::jsonb ELSE NULL END,v_state,v_reason)
 RETURNING analytics_delivery_events.id INTO v_id;
 RETURN QUERY SELECT v_id,v_state,v_reason;
END $$;

-- Reconciliation is limited to already durable source dispositions. It never
-- joins current account contexts to invent the browser of a lost signup freeze.
CREATE FUNCTION public.reconcile_analytics_delivery(p_limit integer DEFAULT 100)
RETURNS TABLE(changed integer) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(710110);
 WITH candidates AS (
  SELECT e.id,CASE WHEN e.state='sending' THEN 'uncertain' WHEN e.occurred_at<clock_timestamp()-interval '72 hours' THEN 'expired' ELSE 'suppressed' END AS next_state,
   CASE WHEN e.state='sending' THEN 'claim_expired' WHEN e.occurred_at<clock_timestamp()-interval '72 hours' THEN 'event_expired' ELSE 'context_revoked_or_expired' END AS next_reason
  FROM public.analytics_delivery_events e LEFT JOIN public.analytics_contexts c ON c.id=e.context_id
  WHERE (e.state='sending' AND e.claimed_at<clock_timestamp()-interval '5 minutes')
   OR (e.state='pending' AND (e.occurred_at<clock_timestamp()-interval '72 hours' OR c.id IS NULL OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp()))
  ORDER BY e.created_at,e.id LIMIT p_limit
 ), updated AS (
  UPDATE public.analytics_delivery_events e SET state=c.next_state,reason=c.next_reason,payload=NULL,claim_token=NULL,finalized_at=clock_timestamp()
  FROM candidates c WHERE e.id=c.id RETURNING e.id
 ) SELECT count(*)::integer INTO changed FROM updated;
 RETURN NEXT;
END $$;

CREATE FUNCTION public.claim_analytics_delivery()
RETURNS TABLE(id uuid,claim_token uuid,client_id text,occurred_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid; v_token uuid:=gen_random_uuid();
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 PERFORM public.reconcile_analytics_delivery(100);
 SELECT e.id INTO v_id FROM public.analytics_delivery_events e JOIN public.analytics_contexts c ON c.id=e.context_id
 WHERE e.state='pending' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
 AND c.user_id=e.user_id AND c.id=e.frozen_context_id AND c.client_id IS NOT NULL
 AND e.occurred_at>=clock_timestamp()-interval '72 hours' AND e.occurred_at<=clock_timestamp()
 ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE OF e;
 IF v_id IS NULL THEN RETURN; END IF;
 UPDATE public.analytics_delivery_events e SET state='sending',claim_token=v_token,claimed_at=clock_timestamp() WHERE e.id=v_id;
 RETURN QUERY SELECT e.id,v_token,c.client_id,e.occurred_at FROM public.analytics_delivery_events e JOIN public.analytics_contexts c ON c.id=e.context_id WHERE e.id=v_id;
END $$;

CREATE FUNCTION public.finalize_analytics_delivery(p_id uuid,p_token uuid,p_state text,p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 IF p_state IS NULL OR p_code IS NULL OR NOT (
  (p_state='accepted_http' AND p_code='http_2xx') OR
  (p_state='uncertain' AND p_code IN('http_non_2xx','transport_error','dispatch_disabled')) OR
  (p_state='invalid' AND p_code='invalid_source')
 ) THEN RAISE EXCEPTION 'Invalid delivery result' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(710110);
 UPDATE public.analytics_delivery_events SET state=p_state,reason=p_code,payload=NULL,claim_token=NULL,finalized_at=clock_timestamp()
 WHERE id=p_id AND state='sending' AND claim_token=p_token;
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count=1;
END $$;
REVOKE ALL ON FUNCTION public.analytics_signup_activation(),public.freeze_analytics_signup(uuid,text,boolean,text),public.reconcile_analytics_delivery(integer),public.claim_analytics_delivery(),public.finalize_analytics_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_signup_activation(),public.freeze_analytics_signup(uuid,text,boolean,text),public.reconcile_analytics_delivery(integer),public.claim_analytics_delivery(),public.finalize_analytics_delivery(uuid,uuid,text,text) TO service_role;
END $migration$;
