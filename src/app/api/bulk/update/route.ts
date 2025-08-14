import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { BulkUpdatePayload } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    const body: BulkUpdatePayload = await req.json();
    const { site_id, operations } = body;

    if (!site_id || !operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { error: 'Missing required fields: site_id, operations' },
        { status: 400 }
      );
    }

    // Verify user authentication and permissions
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

    // Create bulk operation record
    const operationId = uuidv4();
    const { error: operationError } = await supabase
      .from('bulk_operations')
      .insert({
        id: operationId,
        user_id: user.id,
        site_id,
        operation_type: 'batch_update',
        status: 'running',
        total_items: operations.length,
        configuration: { operations },
        started_at: new Date().toISOString()
      });

    if (operationError) {
      throw operationError;
    }

    try {
      // Process bulk updates
      const results = await processBulkUpdates(operations, site_id, user.id, supabase);

      // Update operation status
      await supabase
        .from('bulk_operations')
        .update({
          status: 'completed',
          processed_items: results.successful,
          failed_items: results.failed,
          result_data: {
            successful_updates: results.successful,
            failed_updates: results.failed,
            errors: results.errors,
            updated_elements: results.updatedElements
          },
          completed_at: new Date().toISOString()
        })
        .eq('id', operationId);

      return NextResponse.json({
        operation_id: operationId,
        status: 'completed',
        results: {
          total: operations.length,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
          updated_elements: results.updatedElements
        }
      });

    } catch (processingError) {
      // Update operation status with error
      await supabase
        .from('bulk_operations')
        .update({
          status: 'failed',
          error_log: [processingError instanceof Error ? processingError.message : 'Unknown error'],
          completed_at: new Date().toISOString()
        })
        .eq('id', operationId);

      throw processingError;
    }

  } catch (error) {
    console.error('Bulk update error:', error);
    return NextResponse.json(
      { error: 'Failed to process bulk update' },
      { status: 500 }
    );
  }
}

async function processBulkUpdates(
  operations: BulkUpdatePayload['operations'],
  siteId: string,
  userId: string,
  supabase: any
): Promise<{ successful: number; failed: number; errors: string[]; updatedElements: string[] }> {
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  const updatedElements: string[] = [];

  for (const operation of operations) {
    try {
      const { element_id, operation: op, find, replace, content } = operation;

      // Get current content element
      const { data: element, error: fetchError } = await supabase
        .from('content_elements')
        .select('*')
        .eq('site_id', siteId)
        .eq('element_id', element_id)
        .single();

      if (fetchError || !element) {
        errors.push(`Element ${element_id} not found`);
        failed++;
        continue;
      }

      let newContent = element.current_content;

      // Apply operation
      switch (op) {
        case 'find_replace':
          if (!find || replace === undefined) {
            errors.push(`Element ${element_id}: find_replace requires 'find' and 'replace' parameters`);
            failed++;
            continue;
          }
          newContent = newContent.replace(new RegExp(find, 'g'), replace);
          break;

        case 'append':
          if (!content) {
            errors.push(`Element ${element_id}: append requires 'content' parameter`);
            failed++;
            continue;
          }
          newContent = newContent + content;
          break;

        case 'prepend':
          if (!content) {
            errors.push(`Element ${element_id}: prepend requires 'content' parameter`);
            failed++;
            continue;
          }
          newContent = content + newContent;
          break;

        case 'set':
          if (!content) {
            errors.push(`Element ${element_id}: set requires 'content' parameter`);
            failed++;
            continue;
          }
          newContent = content;
          break;

        default:
          errors.push(`Element ${element_id}: unsupported operation '${op}'`);
          failed++;
          continue;
      }

      // Update content element if changed
      if (newContent !== element.current_content) {
        const { error: updateError } = await supabase
          .from('content_elements')
          .update({
            current_content: newContent,
            updated_at: new Date().toISOString()
          })
          .eq('id', element.id);

        if (updateError) {
          errors.push(`Failed to update ${element_id}: ${updateError.message}`);
          failed++;
          continue;
        }

        updatedElements.push(element_id);
      }

      successful++;
    } catch (error) {
      failed++;
      errors.push(`Failed to process ${operation.element_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { successful, failed, errors, updatedElements };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operationId = searchParams.get('operationId');
    const siteId = searchParams.get('siteId');

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

    if (operationId) {
      // Get specific operation status
      const { data: operation, error } = await supabase
        .from('bulk_operations')
        .select('*')
        .eq('id', operationId)
        .eq('user_id', user.id)
        .single();

      if (error || !operation) {
        return NextResponse.json(
          { error: 'Operation not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(operation);
    } else if (siteId) {
      // Get all bulk update operations for the site
      const { data: operations, error } = await supabase
        .from('bulk_operations')
        .select('*')
        .eq('operation_type', 'batch_update')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }

      return NextResponse.json(operations || []);
    } else {
      return NextResponse.json(
        { error: 'Missing operationId or siteId parameter' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Get bulk update operations error:', error);
    return NextResponse.json(
      { error: 'Failed to get operations' },
      { status: 500 }
    );
  }
}