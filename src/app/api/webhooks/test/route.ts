import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { webhookManager } from '@/lib/webhooks/manager';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { webhook_id } = body;

    if (!webhook_id) {
      return NextResponse.json(
        { error: 'Missing webhook_id' },
        { status: 400 }
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get webhook and verify permissions
    const { data: webhook, error: webhookError } = await supabase
      .from('webhooks')
      .select('site_id, created_by')
      .eq('id', webhook_id)
      .single();

    if (webhookError || !webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', webhook.site_id)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Test the webhook
    const testResult = await webhookManager.testWebhook(webhook_id);
    
    return NextResponse.json(testResult);
  } catch (error) {
    console.error('Test webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to test webhook' },
      { status: 500 }
    );
  }
}