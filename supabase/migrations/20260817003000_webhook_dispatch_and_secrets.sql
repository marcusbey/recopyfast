-- ========================================
-- Webhook dispatch state + show-once secrets   (story s16-webhook-config)
-- ========================================
-- Forward-only. 20260731004000_missing_tables_integrations.sql created these
-- two tables and is not edited here.
--
-- WHY THESE COLUMNS EXIST (ADR 010 — docs/decisions/010-webhook-dispatch-out-of-band.md):
--
-- Dispatch used to be `setTimeout(() => retry(...), delay)` inside the request
-- that failed, with delays up to five minutes. On Vercel the invocation ends at
-- (or shortly after) its response, so that timer never fired in production and
-- said nothing when it didn't. Both "wait out a coalescing window" and "wait out
-- an exponential backoff" therefore have to be *persisted state swept by a
-- cron*, not a timer held open inside one invocation.
--
--   webhooks.pending_*        — the open coalescing window for a site's edits.
--   webhook_deliveries.status — where one delivery is in its retry lifecycle.
--   webhook_deliveries.next_retry_at — when the sweep should re-attempt it.
--
-- RLS: no new policy is added because no new table is created. Both tables
-- already have row-scoped SELECT policies for site members and a service_role
-- FOR ALL policy (20260731004000:36-102); RLS is row-scoped, not column-scoped,
-- so column additions inherit them unchanged.

-- ============================================================
-- webhooks — coalescing window + secret prefix
-- ============================================================

-- The first 8 hex characters of the secret, stored for display. The secret
-- itself stays plaintext (unlike api_keys.key_hash) because deliverWebhook must
-- recover it to compute the HMAC signature at send time, and a hash cannot be
-- reversed for that. What is reused from the API-key shape is the *behaviour* —
-- generated server-side, shown once at creation, never re-listed — not the
-- one-way hash mechanism.
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_prefix TEXT;

-- A burst of edits must produce one rebuild, not one per edit. This is the
-- width of that window, per webhook.
ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS coalesce_window_seconds INTEGER NOT NULL DEFAULT 30;

-- The open window, if any. `pending_dispatch_at` is set once, by the first
-- qualifying event, and is NOT pushed forward by later events in the same
-- window — a throttle, not a debounce. A debounce that resets on every edit has
-- no upper bound on latency under continuous editing, which is a worse failure
-- for a "rebuild my site" trigger than delivering early with a merged payload.
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS pending_event_type TEXT;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS pending_payload JSONB;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS pending_dispatch_at TIMESTAMPTZ;

-- The sweep's only query shape: "which windows have elapsed". Partial, because
-- the overwhelming majority of rows have no window open at any moment.
CREATE INDEX IF NOT EXISTS idx_webhooks_pending_dispatch
  ON webhooks (pending_dispatch_at)
  WHERE pending_dispatch_at IS NOT NULL;

-- ============================================================
-- webhook_deliveries — persisted retry state
-- ============================================================

-- DEFAULT 'delivered' rather than 'pending': every row written before this
-- migration was inserted after its attempt had already resolved, and the
-- `success` boolean beside it records the outcome. Defaulting to 'pending'
-- would retroactively describe historical rows as in-flight forever.
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'delivered'
  CHECK (status IN ('pending', 'delivered', 'retrying', 'failed'));

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- The retry sweep's only query shape: "which attempts are due".
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry
  ON webhook_deliveries (next_retry_at)
  WHERE next_retry_at IS NOT NULL;
