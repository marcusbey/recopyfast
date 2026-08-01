-- ========================================
-- Missing Tables: Webhooks, Bulk Operations, Blog
-- ========================================
-- webhooks, webhook_deliveries, bulk_operations and blog_posts are queried by
-- application code but existed only in the loose supabase/analytics-schema.sql
-- and supabase/schema.sql, which `supabase db push` never runs.
-- ========================================

-- ============================================================
-- webhooks   (src/lib/webhooks/manager.ts, src/app/api/webhooks/route.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER DEFAULT 0,
  max_failures INTEGER DEFAULT 5,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_site_active
  ON webhooks(site_id, is_active);
-- manager.ts:146 uses .contains("events", [eventType]) → array containment.
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON webhooks USING GIN (events);

DROP TRIGGER IF EXISTS update_webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view webhooks" ON webhooks;
CREATE POLICY "Site members can view webhooks"
  ON webhooks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = webhooks.site_id
        AND sp.user_id = auth.uid()
    )
  );

-- Secrets live in this table, so mutations are service-role only; the API
-- routes go through WebhookManager, which uses the service-role client.
DROP POLICY IF EXISTS "Service role can manage webhooks" ON webhooks;
CREATE POLICY "Service role can manage webhooks"
  ON webhooks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- webhook_deliveries   (src/lib/webhooks/manager.ts:250, :354, :398, :461)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  response_time INTEGER,  -- milliseconds
  attempt_number INTEGER DEFAULT 1,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_delivered
  ON webhook_deliveries(webhook_id, delivered_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site members can view webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Site members can view webhook deliveries"
  ON webhook_deliveries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM webhooks w
      JOIN site_permissions sp ON sp.site_id = w.site_id
      WHERE w.id = webhook_deliveries.webhook_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Service role can manage webhook deliveries"
  ON webhook_deliveries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- bulk_operations   (src/app/api/bulk/{import,update,export}/route.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS bulk_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('import', 'export', 'batch_update', 'sync')
  ),
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  configuration JSONB DEFAULT '{}',
  result_data JSONB DEFAULT '{}',
  error_log TEXT[],
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- bulk/export/route.ts:278 filters operation_type + site_id (+ optional
-- user_id) ordered by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_bulk_operations_site_type_created
  ON bulk_operations(site_id, operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_operations_user_id ON bulk_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_bulk_operations_status ON bulk_operations(status);

ALTER TABLE bulk_operations ENABLE ROW LEVEL SECURITY;

-- The bulk routes run under the caller's anon-key session and check
-- site_permissions in application code before writing, so the policies mirror
-- that: read for any site member, write for editors/admins of the same site.
DROP POLICY IF EXISTS "Site members can view bulk operations" ON bulk_operations;
CREATE POLICY "Site members can view bulk operations"
  ON bulk_operations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = bulk_operations.site_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Site editors can create bulk operations" ON bulk_operations;
CREATE POLICY "Site editors can create bulk operations"
  ON bulk_operations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM site_permissions sp
      WHERE sp.site_id = bulk_operations.site_id
        AND sp.user_id = auth.uid()
        AND sp.permission IN ('edit', 'admin')
    )
  );

DROP POLICY IF EXISTS "Owners can update their bulk operations" ON bulk_operations;
CREATE POLICY "Owners can update their bulk operations"
  ON bulk_operations
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage bulk operations" ON bulk_operations;
CREATE POLICY "Service role can manage bulk operations"
  ON bulk_operations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- blog_posts
--   read : src/app/blog/[slug]/page.tsx:25  (public, anon key)
--   write: src/app/api/blog/generate/route.ts:274
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug_status ON blog_posts(slug, status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published
  ON blog_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);

DROP TRIGGER IF EXISTS update_blog_posts_updated_at ON blog_posts;
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- supabase/schema.sql shipped blog_posts with no RLS at all ("public (no RLS
-- needed for now)").  Without RLS, Supabase's default grants let anyone holding
-- the public anon key INSERT/UPDATE/DELETE blog posts, so RLS is enabled here:
-- published posts stay world-readable, drafts do not.
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Published blog posts are public" ON blog_posts;
CREATE POLICY "Published blog posts are public"
  ON blog_posts
  FOR SELECT
  USING (status = 'published');

-- Interactive-admin path of src/app/api/blog/generate/route.ts (it authorises on
-- app_metadata.role === 'admin' and then writes with the anon-key client).
--
-- ACTION REQUIRED: the *cron* path of that route authorises on CRON_SECRET and
-- therefore has no session — it runs as `anon` and will be rejected here.
-- src/app/api/blog/generate/route.ts:270 must switch to the service-role client
-- (createServiceRoleClient from @/lib/supabase/service) for scheduled runs.
DROP POLICY IF EXISTS "Admins can write blog posts" ON blog_posts;
CREATE POLICY "Admins can write blog posts"
  ON blog_posts
  FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Service role can manage blog posts" ON blog_posts;
CREATE POLICY "Service role can manage blog posts"
  ON blog_posts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
