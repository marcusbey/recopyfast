-- s112: normalization receipts are private pipeline bookkeeping, never payment
-- truth. No billing handler or existing financial record is modified here.
DO $migration$ BEGIN
CREATE TABLE public.analytics_delivery_sources (
 stripe_event_id text PRIMARY KEY REFERENCES public.billing_events(stripe_event_id) ON DELETE CASCADE,
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN('pending','normalizing','complete','unknown','suppressed')),
 reason text NOT NULL CHECK(reason ~ '^[a-z_]{1,64}$'),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_token uuid, claimed_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 outbox_id uuid REFERENCES public.analytics_delivery_events(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(state<>'normalizing' OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
ALTER TABLE public.analytics_delivery_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_delivery_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.analytics_delivery_sources TO service_role;
CREATE POLICY analytics_sources_service ON public.analytics_delivery_sources FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX analytics_sources_retry ON public.analytics_delivery_sources(next_attempt_at,stripe_event_id) WHERE state IN('pending','normalizing');
CREATE INDEX analytics_sources_user ON public.analytics_delivery_sources(user_id);
CREATE INDEX billing_events_analytics_processed ON public.billing_events(created_at,stripe_event_id)
 WHERE processed=true AND event_type IN('payment_intent.succeeded','invoice.payment_succeeded','checkout.session.completed','charge.refunded','charge.dispute.created','charge.dispute.closed');
CREATE INDEX billing_events_analytics_pi ON public.billing_events((data->'object'->>'id'),created_at)
 WHERE processed=true AND event_type='payment_intent.succeeded';

ALTER TABLE public.analytics_delivery_events ADD COLUMN transaction_id uuid,
 ADD COLUMN parent_purchase_id uuid REFERENCES public.analytics_delivery_events(id) ON DELETE SET NULL;
-- Replace only CHECK constraints, preserving the existing unique keys, RLS,
-- service grants and account/context deletion actions unchanged.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.analytics_delivery_events'::regclass AND contype='c' LOOP
  EXECUTE format('ALTER TABLE public.analytics_delivery_events DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
CREATE FUNCTION public.valid_analytics_commerce_payload(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT (p ?& ARRAY['mode','value_minor','tax_minor','item_id','quantity']) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('mode','value_minor','tax_minor','item_id','quantity','customer_type')) THEN RETURN false; END IF;
 RETURN coalesce(p->>'mode'='live' AND p->>'item_id' IN('starter','pro','agency','credits','lifetime_pro','lifetime_agency')
 AND jsonb_typeof(p->'value_minor')='number' AND (p->>'value_minor')::numeric BETWEEN 1 AND 9007199254740991 AND trunc((p->>'value_minor')::numeric)=(p->>'value_minor')::numeric
 AND jsonb_typeof(p->'tax_minor')='number' AND (p->>'tax_minor')::numeric BETWEEN 0 AND 9007199254740991 AND trunc((p->>'tax_minor')::numeric)=(p->>'tax_minor')::numeric
 AND jsonb_typeof(p->'quantity')='number' AND (p->>'quantity')::numeric BETWEEN 1 AND 100000 AND trunc((p->>'quantity')::numeric)=(p->>'quantity')::numeric
 AND (NOT p?'customer_type' OR p->>'customer_type' IN('new','returning')),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
ALTER TABLE public.analytics_delivery_events
 ADD CHECK(kind IN('signup','purchase','refund')),
 ADD CHECK(payload IS NULL OR (kind='signup' AND payload='{"method":"email"}'::jsonb) OR (kind IN('purchase','refund') AND public.valid_analytics_commerce_payload(payload))),
 ADD CHECK(state IN('pending','sending','accepted_http','suppressed','invalid','uncertain','expired')),
 ADD CHECK(reason IN('eligible','preexisting_confirmed','initial_confirmation_unproven','context_unavailable','before_activation','event_expired','context_revoked_or_expired','http_2xx','http_non_2xx','transport_error','invalid_source','dispatch_disabled','claim_expired','purchase_unsent','purchase_waiting','reconciliation_required')),
 ADD CHECK((kind='signup' AND source_key='signup:'||user_id::text AND transaction_id IS NULL AND parent_purchase_id IS NULL)
 OR (kind='purchase' AND source_key ~ '^purchase:live:(invoice:in_|payment_intent:pi_)[A-Za-z0-9]+$' AND transaction_id IS NOT NULL AND parent_purchase_id IS NULL)
 OR (kind='refund' AND source_key ~ '^refund:live:re_[A-Za-z0-9]+:(invoice:in_|payment_intent:pi_)[A-Za-z0-9]+$' AND transaction_id IS NOT NULL)),
 ADD CHECK(context_id IS NULL OR context_id=frozen_context_id),
 ADD CHECK((state IN('pending','sending') AND payload IS NOT NULL AND frozen_context_id IS NOT NULL) OR (state NOT IN('pending','sending') AND payload IS NULL)),
 ADD CHECK((state='sending' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL) OR state<>'sending');

-- New and retry lanes each receive half the slots. A poisoned old source cannot
-- starve new sources, and constant new traffic cannot starve interrupted work.
CREATE FUNCTION public.claim_analytics_payment_sources(p_limit integer DEFAULT 4)
RETURNS TABLE(stripe_event_id text,event_type text,data jsonb,processed boolean,claim_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE fresh text[]; retries text[]; ids text[]; slots integer;
BEGIN
 IF p_limit IS NULL OR p_limit<2 OR p_limit>10 THEN RAISE EXCEPTION 'Invalid batch' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(710112);
 slots:=p_limit/2;
 WITH candidates AS (
  SELECT b.stripe_event_id,b.user_id FROM public.billing_events b WHERE b.processed=true
  AND b.event_type IN('payment_intent.succeeded','invoice.payment_succeeded','checkout.session.completed','charge.refunded','charge.dispute.created','charge.dispute.closed')
  AND NOT EXISTS(SELECT 1 FROM public.analytics_delivery_sources s WHERE s.stripe_event_id=b.stripe_event_id)
  ORDER BY b.created_at,b.stripe_event_id LIMIT slots
 ), inserted AS (
  INSERT INTO public.analytics_delivery_sources(stripe_event_id,user_id,state,reason)
   SELECT c.stripe_event_id,c.user_id,'pending','new_source' FROM candidates c ON CONFLICT DO NOTHING RETURNING analytics_delivery_sources.stripe_event_id
 ) SELECT array_agg(i.stripe_event_id) INTO fresh FROM inserted i;
 SELECT array_agg(r.stripe_event_id) INTO retries FROM (
  SELECT s.stripe_event_id FROM public.analytics_delivery_sources s JOIN public.billing_events b USING(stripe_event_id)
  WHERE b.processed AND NOT(s.stripe_event_id=ANY(coalesce(fresh,ARRAY[]::text[])))
  AND ((s.state='pending' AND s.next_attempt_at<=clock_timestamp()) OR (s.state='normalizing' AND s.claimed_at<clock_timestamp()-interval '5 minutes'))
  ORDER BY s.next_attempt_at,s.stripe_event_id LIMIT p_limit-coalesce(array_length(fresh,1),0)
 ) r;
 ids:=coalesce(fresh,ARRAY[]::text[])||coalesce(retries,ARRAY[]::text[]);
 UPDATE public.analytics_delivery_sources s SET state='normalizing',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),attempts=attempts+1 WHERE s.stripe_event_id=ANY(ids);
 RETURN QUERY SELECT b.stripe_event_id,b.event_type,b.data,b.processed,s.claim_token FROM public.billing_events b JOIN public.analytics_delivery_sources s USING(stripe_event_id) WHERE b.stripe_event_id=ANY(ids) ORDER BY b.created_at,b.stripe_event_id;
END $$;

-- Definer solely for the auth.users existence/key-share check, matching s111
-- freeze authority. Web roles have no EXECUTE; all writes stay account-scoped.
CREATE FUNCTION public.finish_analytics_payment_source(p_event_id text,p_token uuid,p_state text,p_reason text,p_candidates jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.analytics_delivery_sources; candidate jsonb; account uuid; occurred timestamptz; context uuid; frozen uuid;
 entry_id uuid; tx uuid; parent public.analytics_delivery_events; delivery_state text; delivery_reason text; source_user uuid;
BEGIN
 IF p_state IS NULL OR p_state NOT IN('pending','complete','unknown','suppressed') OR p_reason IS NULL OR p_reason !~ '^[a-z_]{1,64}$' OR p_candidates IS NULL OR jsonb_typeof(p_candidates)<>'array' OR jsonb_array_length(p_candidates)>120 THEN RAISE EXCEPTION 'Invalid normalization' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(710112);
 PERFORM pg_advisory_xact_lock(710110);
 SELECT * INTO receipt FROM public.analytics_delivery_sources s WHERE s.stripe_event_id=p_event_id AND s.state='normalizing' AND s.claim_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT b.user_id INTO source_user FROM public.billing_events b WHERE b.stripe_event_id=p_event_id AND b.processed;
 IF NOT FOUND THEN RETURN false; END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
  IF candidate->>'kind' NOT IN('purchase','refund','exclude_purchase') OR NOT public.valid_analytics_commerce_payload(candidate->'payload') THEN RAISE EXCEPTION 'Invalid commerce candidate' USING ERRCODE='22023'; END IF;
  account:=(candidate->>'user_id')::uuid; occurred:=(candidate->>'occurred_at')::timestamptz;
  IF account IS NULL OR occurred IS NULL OR occurred>clock_timestamp() OR (source_user IS NOT NULL AND account<>source_user) THEN RAISE EXCEPTION 'Invalid payment authority' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.users u WHERE u.id=account FOR KEY SHARE;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.analytics_delivery_events e WHERE e.source_key=candidate->>'source_key' AND e.user_id<>account) THEN RAISE EXCEPTION 'Canonical owner mismatch' USING ERRCODE='22023'; END IF;
  IF candidate->>'kind'='exclude_purchase' THEN
   -- A stale purchase normalization can finish after its automatic-return
   -- source. UPDATE-only recorded nothing when the purchase did not exist,
   -- allowing that stale source to enqueue acquisition later. Freeze a durable
   -- absent/suppressed disposition under the same canonical key and locks.
   -- Already claimed/accepted/uncertain rows are immutable here: their refund
   -- must preserve the original transaction/context and delivery ordering.
   INSERT INTO public.analytics_delivery_events(kind,source_key,user_id,occurred_at,state,reason,transaction_id)
   VALUES('purchase',candidate->>'source_key',account,occurred,'suppressed','purchase_unsent',gen_random_uuid())
   ON CONFLICT(source_key) DO UPDATE SET state='suppressed',reason='purchase_unsent',payload=NULL
   WHERE analytics_delivery_events.user_id=EXCLUDED.user_id AND analytics_delivery_events.kind='purchase' AND analytics_delivery_events.state='pending';
   SELECT e.id INTO entry_id FROM public.analytics_delivery_events e WHERE e.source_key=candidate->>'source_key' AND e.user_id=account;
   UPDATE public.analytics_delivery_sources SET user_id=account,outbox_id=coalesce(outbox_id,entry_id) WHERE stripe_event_id=p_event_id;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.analytics_delivery_events e WHERE e.source_key=candidate->>'source_key') THEN CONTINUE; END IF;
  context:=NULL; frozen:=NULL; parent:=NULL; tx:=gen_random_uuid(); delivery_state:='suppressed'; delivery_reason:='context_unavailable';
  IF candidate->>'kind'='purchase' THEN
    SELECT c.id INTO context FROM public.eligible_analytics_context(account,occurred,NULL) c; frozen:=context;
  ELSE
    SELECT * INTO parent FROM public.analytics_delivery_events e WHERE e.source_key=candidate->>'parent_source_key' AND e.kind='purchase' AND e.user_id=account;
    IF NOT FOUND THEN
      IF candidate->>'only_existing_parent'='true' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Purchase source missing' USING ERRCODE='22023';
    END IF;
    IF right(candidate->>'source_key',length(parent.source_key)-length('purchase:live:')+1) <> ':'||substring(parent.source_key FROM length('purchase:live:')+1) THEN RAISE EXCEPTION 'Refund parent identity mismatch' USING ERRCODE='22023'; END IF;
    tx:=parent.transaction_id; frozen:=parent.frozen_context_id;
    SELECT c.id INTO context FROM public.analytics_contexts c WHERE c.id=parent.context_id AND c.id=parent.frozen_context_id AND c.user_id=account
    AND c.captured_at<=occurred AND c.bound_at<=occurred AND c.consent_at<=occurred AND c.expires_at>occurred AND c.expires_at>clock_timestamp() AND c.revoked_at IS NULL;
    IF parent.state IN('suppressed','invalid','expired') THEN context:=NULL; delivery_reason:='purchase_unsent'; END IF;
  END IF;
  IF occurred<clock_timestamp()-interval '72 hours' THEN delivery_state:='expired'; delivery_reason:='event_expired';
  ELSIF context IS NOT NULL THEN delivery_state:='pending'; delivery_reason:=CASE WHEN parent.state IN('sending','uncertain') THEN 'reconciliation_required' WHEN parent.state='pending' THEN 'purchase_waiting' ELSE 'eligible' END; END IF;
  INSERT INTO public.analytics_delivery_events(kind,source_key,user_id,context_id,frozen_context_id,occurred_at,payload,state,reason,transaction_id,parent_purchase_id)
  VALUES(candidate->>'kind',candidate->>'source_key',account,context,frozen,occurred,CASE WHEN delivery_state='pending' THEN candidate->'payload' ELSE NULL END,delivery_state,delivery_reason,tx,parent.id)
  ON CONFLICT(source_key) DO NOTHING RETURNING id INTO entry_id;
  UPDATE public.analytics_delivery_sources SET user_id=account,outbox_id=coalesce(outbox_id,entry_id) WHERE stripe_event_id=p_event_id;
 END LOOP;
 UPDATE public.analytics_delivery_sources SET state=p_state,reason=p_reason,claim_token=NULL,claimed_at=NULL,next_attempt_at=clock_timestamp()+interval '5 minutes' WHERE stripe_event_id=p_event_id;
 RETURN true;
END $$;

CREATE FUNCTION public.claim_analytics_delivery_version(p_commerce boolean)
RETURNS TABLE(id uuid,claim_token uuid,client_id text,occurred_at timestamptz,kind text,payload jsonb,transaction_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid; v_token uuid:=gen_random_uuid();
BEGIN
 PERFORM pg_advisory_xact_lock(710110);
 PERFORM public.reconcile_analytics_delivery(100);
 -- A known-unsent parent cannot have a meaningful GA refund. An uncertain
 -- parent is different: retain the refund for explicit reconciliation, not send.
 WITH children AS (
  SELECT e.id,CASE WHEN p.state IN('suppressed','invalid','expired') THEN 'suppressed' ELSE 'pending' END next_state,
   CASE WHEN p.state IN('suppressed','invalid','expired') THEN 'purchase_unsent' ELSE 'reconciliation_required' END next_reason
  FROM public.analytics_delivery_events e JOIN public.analytics_delivery_events p ON p.id=e.parent_purchase_id
  WHERE e.kind='refund' AND e.state='pending' AND (p.state IN('suppressed','invalid','expired') OR (p.state IN('sending','uncertain') AND e.reason<>'reconciliation_required'))
  ORDER BY e.created_at,e.id LIMIT 100
 ) UPDATE public.analytics_delivery_events e SET state=c.next_state,reason=c.next_reason,payload=CASE WHEN c.next_state='pending' THEN e.payload ELSE NULL END FROM children c WHERE c.id=e.id;
 SELECT e.id INTO v_id FROM public.analytics_delivery_events e JOIN public.analytics_contexts c ON c.id=e.context_id
 LEFT JOIN public.analytics_delivery_events p ON p.id=e.parent_purchase_id
 WHERE e.state='pending' AND (p_commerce IS TRUE OR e.kind='signup') AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.user_id=e.user_id AND c.id=e.frozen_context_id AND c.client_id IS NOT NULL
 AND e.occurred_at>=clock_timestamp()-interval '72 hours' AND e.occurred_at<=clock_timestamp()
 AND (e.kind<>'refund' OR p.state='accepted_http')
 ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE OF e;
 IF v_id IS NULL THEN RETURN; END IF;
 UPDATE public.analytics_delivery_events e SET state='sending',claim_token=v_token,claimed_at=clock_timestamp() WHERE e.id=v_id;
 RETURN QUERY SELECT e.id,v_token,c.client_id,e.occurred_at,e.kind,e.payload,e.transaction_id FROM public.analytics_delivery_events e JOIN public.analytics_contexts c ON c.id=e.context_id WHERE e.id=v_id;
END $$;
-- Preserve the old RPC return shape AND signup-only semantics while old code
-- is still running, or after rollback. Old workers must never see commerce.
CREATE OR REPLACE FUNCTION public.claim_analytics_delivery()
RETURNS TABLE(id uuid,claim_token uuid,client_id text,occurred_at timestamptz)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT r.id,r.claim_token,r.client_id,r.occurred_at FROM public.claim_analytics_delivery_version(false) r;
$$;
CREATE FUNCTION public.claim_analytics_delivery_v2()
RETURNS TABLE(id uuid,claim_token uuid,client_id text,occurred_at timestamptz,kind text,payload jsonb,transaction_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM public.claim_analytics_delivery_version(true); $$;
REVOKE ALL ON FUNCTION public.claim_analytics_delivery_version(boolean),public.claim_analytics_delivery_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analytics_delivery_version(boolean),public.claim_analytics_delivery_v2() TO service_role;

-- Bounded read-only account evidence for first-payer classification; this is
-- existing financial truth, not the consented delivery subset or a new ledger.
CREATE FUNCTION public.analytics_payment_history(p_user_id uuid,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE sources jsonb; expected jsonb; current_refs jsonb; source_count integer; expected_count integer; current_count integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>25 THEN RAISE EXCEPTION 'Invalid history bound' USING ERRCODE='22023'; END IF;
 WITH selected AS (
  SELECT b.stripe_event_id,b.event_type,b.data,b.processed FROM public.billing_events b
  WHERE (b.user_id=p_user_id OR b.data->'object'->>'customer' IN(SELECT c.stripe_customer_id FROM public.billing_customers c WHERE c.user_id=p_user_id))
  AND b.event_type IN('payment_intent.succeeded','invoice.payment_succeeded','checkout.session.completed')
  ORDER BY b.created_at,b.stripe_event_id LIMIT p_limit+1
 ) SELECT coalesce(jsonb_agg(to_jsonb(selected)),'[]'),count(*) INTO sources,source_count FROM selected;
 WITH refs AS (
  SELECT 'invoice:'||i.stripe_invoice_id AS key FROM public.billing_invoices i JOIN public.billing_customers c ON c.id=i.customer_id WHERE c.user_id=p_user_id AND i.amount_paid>0
  UNION SELECT 'payment_intent:'||c.stripe_payment_intent_id FROM public.credit_purchases c WHERE c.user_id=p_user_id AND c.stripe_payment_intent_id IS NOT NULL
  UNION SELECT 'payment_intent:'||e.stripe_payment_intent_id FROM public.plan_entitlements e WHERE e.user_id=p_user_id AND e.stripe_payment_intent_id IS NOT NULL
 ), bounded AS (SELECT key FROM refs ORDER BY key LIMIT p_limit+1)
 SELECT coalesce(jsonb_agg(key),'[]'),count(*) INTO expected,expected_count FROM bounded;
 WITH refs AS (
  SELECT 'invoice:'||i.stripe_invoice_id AS key FROM public.billing_invoices i JOIN public.billing_subscriptions s ON s.id=i.subscription_id
  WHERE s.user_id=p_user_id AND s.status IN('active','past_due') AND s.plan IN('starter','pro','agency') AND i.amount_paid>0
  UNION SELECT 'payment_intent:'||e.stripe_payment_intent_id FROM public.plan_entitlements e
  WHERE e.user_id=p_user_id AND e.source='lifetime_purchase' AND e.plan_id IN('starter','pro','agency') AND e.stripe_payment_intent_id IS NOT NULL AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>statement_timestamp())
 ), bounded AS (SELECT key FROM refs ORDER BY key LIMIT p_limit+1)
 SELECT coalesce(jsonb_agg(key),'[]'),count(*) INTO current_refs,current_count FROM bounded;
 RETURN jsonb_build_object('sources',sources,'expected_keys',expected,'complete',source_count<=p_limit AND expected_count<=p_limit,'current_paid_reference_keys',current_refs,'current_paid_references_complete',current_count<=p_limit);
END $$;
REVOKE ALL ON FUNCTION public.analytics_payment_history(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_payment_history(uuid,integer) TO service_role;
-- Counts only: operator diagnostics expose completeness, never client identifiers.
CREATE FUNCTION public.analytics_payment_diagnostics() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'source_states',coalesce((SELECT jsonb_object_agg(state,n) FROM(SELECT state,count(*) n FROM public.analytics_delivery_sources GROUP BY state)t),'{}'),
  'unknown_reasons',coalesce((SELECT jsonb_object_agg(reason,n) FROM(SELECT reason,count(*) n FROM public.analytics_delivery_sources WHERE state IN('unknown','pending') GROUP BY reason)t),'{}'),
  'delivery_states',coalesce((SELECT jsonb_object_agg(state,n) FROM(SELECT state,count(*) n FROM public.analytics_delivery_events WHERE kind IN('purchase','refund') GROUP BY state)t),'{}'),
  'omitted_context',(SELECT count(*) FROM public.analytics_delivery_events WHERE kind IN('purchase','refund') AND reason IN('context_unavailable','context_revoked_or_expired'))
 );
$$;
REVOKE ALL ON FUNCTION public.analytics_payment_diagnostics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_payment_diagnostics() TO service_role;
REVOKE ALL ON FUNCTION public.valid_analytics_commerce_payload(jsonb),public.claim_analytics_payment_sources(integer),public.finish_analytics_payment_source(text,uuid,text,text,jsonb),public.claim_analytics_delivery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valid_analytics_commerce_payload(jsonb),public.claim_analytics_payment_sources(integer),public.finish_analytics_payment_source(text,uuid,text,text,jsonb),public.claim_analytics_delivery() TO service_role;
END $migration$;
