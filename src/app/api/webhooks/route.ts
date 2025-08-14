import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { webhookManager, WEBHOOK_EVENTS } from '@/lib/webhooks/manager';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json(
        { error: 'Missing siteId parameter' },
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

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const webhooks = await webhookManager.getWebhooks(siteId);
    return NextResponse.json(webhooks);
  } catch (error) {
    console.error('Get webhooks error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch webhooks' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { site_id, url, events, secret } = body;

    if (!site_id || !url || !events || !Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Missing required fields: site_id, url, events' },
        { status: 400 }
      );
    }

    // Validate events
    const validEvents = Object.values(WEBHOOK_EVENTS);
    const invalidEvents = events.filter((event: string) => !validEvents.includes(event as any));
    
    if (invalidEvents.length > 0) {
      return NextResponse.json(
        { error: `Invalid events: ${invalidEvents.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL' },
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

    // Check site permissions
    const { data: permission } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', site_id)
      .eq('user_id', user.id)
      .single();

    if (!permission || !['edit', 'admin'].includes(permission.permission)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const webhook = await webhookManager.createWebhook({
      siteId: site_id,
      url,
      events,
      secret,
      createdBy: user.id
    });

    return NextResponse.json(webhook, { status: 201 });
  } catch (error) {
    console.error('Create webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to create webhook' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { webhook_id, ...updates } = body;

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

    // Validate events if provided
    if (updates.events && Array.isArray(updates.events)) {
      const validEvents = Object.values(WEBHOOK_EVENTS);
      const invalidEvents = updates.events.filter((event: string) => !validEvents.includes(event as any));
      
      if (invalidEvents.length > 0) {
        return NextResponse.json(
          { error: `Invalid events: ${invalidEvents.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Validate URL if provided
    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        return NextResponse.json(
          { error: 'Invalid URL' },
          { status: 400 }
        );
      }
    }

    const updatedWebhook = await webhookManager.updateWebhook(webhook_id, updates);
    return NextResponse.json(updatedWebhook);
  } catch (error) {
    console.error('Update webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to update webhook' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const webhookId = searchParams.get('webhookId');

    if (!webhookId) {
      return NextResponse.json(
        { error: 'Missing webhookId parameter' },
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
      .eq('id', webhookId)
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

    await webhookManager.deleteWebhook(webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Delete webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to delete webhook' },
      { status: 500 }
    );
  }
}