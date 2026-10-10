import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { BulkUpdatePayload } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { MAX_BULK_UPDATE_OPERATIONS } from "@/lib/bulk/constants";

export async function POST(req: NextRequest) {
  try {
    // Rate limit before authorization, per AGENTS.md: the permission check
    // below costs a `site_permissions` lookup, so a limiter placed behind it
    // never sees the flood it exists to stop. Above the body read as well: a
    // refusal should not pay for parsing an operations array.
    //
    // `deny` on store failure: since s56 (ADR 042) this route rewrites
    // `published_content` through the SERVICE role, in a loop, and a
    // service-role write path is fail-closed or it does not exist (AGENTS.md).
    // Until s56 it had no limiter at all (ADR 041 "Watch").
    const limited = await enforceRateLimit(req, {
      limit: "API_UPLOAD",
      endpoint: "bulk/update",
      onStoreFailure: "deny",
    });
    if (limited) return limited;

    const body: BulkUpdatePayload = await req.json();
    const { site_id, operations } = body;

    if (!site_id || !operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { error: "Missing required fields: site_id, operations" },
        { status: 400 },
      );
    }

    // s77 (s69 R2): bounded before the session is read — see
    // MAX_BULK_UPDATE_OPERATIONS for the number and why.
    if (operations.length > MAX_BULK_UPDATE_OPERATIONS) {
      return NextResponse.json(
        {
          error: `At most ${MAX_BULK_UPDATE_OPERATIONS} operations per request.`,
        },
        { status: 400 },
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
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", site_id)
      .eq("user_id", user.id)
      .single();

    if (!permission || !["edit", "admin"].includes(permission.permission)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Rewrites `published_content` directly, so it needs the SITE OWNER's plan
    // (s51, ADR 041), checked after the permission read (no oracle) and before
    // the `bulk_operations` row (a refusal writes nothing).
    const ownerCanEdit = await checkOwnerCanEdit(site_id);
    if (!ownerCanEdit.ok) {
      return ownerCanEditRefusal(ownerCanEdit);
    }

    // The content write goes through the service role (s56, ADR 042). No web
    // principal holds DML on `content_elements` any more: a member's direct
    // PostgREST PATCH used to bypass the owner-plan gate above (s51 review,
    // finding 1). Created only now — after `getUser()`, the `edit`/`admin`
    // read and the gate — and scoped by the `site_id` that read established,
    // because RLS no longer re-checks the row (ADR 037 step 5). The lookups
    // and the `bulk_operations` rows stay on the caller's own client.
    const writer = createServiceRoleClient();

    // Create bulk operation record
    const operationId = uuidv4();
    const { error: operationError } = await supabase
      .from("bulk_operations")
      .insert({
        id: operationId,
        user_id: user.id,
        site_id,
        operation_type: "batch_update",
        status: "running",
        total_items: operations.length,
        configuration: { operations },
        started_at: new Date().toISOString(),
      });

    if (operationError) {
      throw operationError;
    }

    try {
      // Process bulk updates
      const results = await processBulkUpdates(
        operations,
        site_id,
        user.id,
        supabase,
        writer,
      );

      // Update operation status
      await supabase
        .from("bulk_operations")
        .update({
          status: "completed",
          processed_items: results.successful,
          failed_items: results.failed,
          result_data: {
            successful_updates: results.successful,
            failed_updates: results.failed,
            errors: results.errors,
            updated_elements: results.updatedElements,
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      return NextResponse.json({
        operation_id: operationId,
        status: "completed",
        results: {
          total: operations.length,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
          updated_elements: results.updatedElements,
        },
      });
    } catch (processingError) {
      // Update operation status with error
      await supabase
        .from("bulk_operations")
        .update({
          status: "failed",
          error_log: [
            processingError instanceof Error
              ? processingError.message
              : "Unknown error",
          ],
          completed_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      throw processingError;
    }
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json(
      { error: "Failed to process bulk update" },
      { status: 500 },
    );
  }
}

/*
 * TOMBSTONE — s68b M2, ADR 048. `useRegex: true` used to run
 * `new RegExp(find, "g")` over the element's copy, behind `MAX_REGEX_LENGTH`
 * and `isDangerousRegex` — two shape checks that could not see nesting.
 * `((a+))+$` passed them, and against thirty `a`s and a `!` it held the
 * function for ~16 s per operation (measured 2026-10-08). The mode had no
 * caller. It is refused per operation now and no RegExp is built from request
 * input in this route. Do not restore it behind a better heuristic — polynomial
 * patterns defeat every shape check; regex replace comes back only as a story
 * with a linear-time engine and a test that fails on `((a+))+$`.
 */
const REGEX_MODE_REFUSAL =
  "Regex find/replace is not supported; use literal find/replace.";

/**
 * Replace ALL occurrences of `needle` in `haystack` using a plain literal
 * comparison — no regex involved, so no ReDoS risk.
 */
function replaceLiteral(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  // String.prototype.split + join is the idiomatic O(n) literal replace-all.
  // We use a recursive escape approach so we never touch RegExp here.
  return haystack.split(needle).join(replacement);
}

async function processBulkUpdates(
  operations: BulkUpdatePayload["operations"],
  siteId: string,
  userId: string,
  supabase: ReturnType<typeof import("@supabase/ssr").createServerClient>,
  writer: ReturnType<typeof createServiceRoleClient>,
): Promise<{
  successful: number;
  failed: number;
  errors: string[];
  updatedElements: string[];
}> {
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];
  const updatedElements: string[] = [];

  for (const operation of operations) {
    try {
      const { element_id, operation: op, find, replace, content } = operation;

      // Refused before the element read: a regex operation costs nothing and
      // writes nothing (ADR 048, see REGEX_MODE_REFUSAL).
      if ("useRegex" in operation && operation.useRegex) {
        errors.push(`Element ${element_id}: ${REGEX_MODE_REFUSAL}`);
        failed++;
        continue;
      }

      // Get current content element
      const { data: element, error: fetchError } = await supabase
        .from("content_elements")
        .select("*")
        .eq("site_id", siteId)
        .eq("element_id", element_id)
        .single();

      if (fetchError || !element) {
        errors.push(`Element ${element_id} not found`);
        failed++;
        continue;
      }

      let newContent = element.current_content;

      // Apply operation
      switch (op) {
        case "find_replace":
          if (!find || replace === undefined) {
            errors.push(
              `Element ${element_id}: find_replace requires 'find' and 'replace' parameters`,
            );
            failed++;
            continue;
          }

          // Literal replace-all — the only find/replace there is (ADR 048).
          newContent = replaceLiteral(newContent, find, replace);
          break;

        case "append":
          if (!content) {
            errors.push(
              `Element ${element_id}: append requires 'content' parameter`,
            );
            failed++;
            continue;
          }
          newContent = newContent + content;
          break;

        case "prepend":
          if (!content) {
            errors.push(
              `Element ${element_id}: prepend requires 'content' parameter`,
            );
            failed++;
            continue;
          }
          newContent = content + newContent;
          break;

        case "set":
          if (!content) {
            errors.push(
              `Element ${element_id}: set requires 'content' parameter`,
            );
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

      // Sanitize computed content before writing to DB (XSS prevention)
      const sanitizedNewContent = sanitizeHTML(newContent, "RICH_TEXT");

      // Update content element if changed. `element.id` was read back through
      // the caller's RLS client, filtered by this site; the `site_id` filter
      // repeats that scope on the service-role write, which RLS no longer
      // checks (s56).
      if (sanitizedNewContent !== element.current_content) {
        const { error: updateError } = await writer
          .from("content_elements")
          .update({
            published_content: sanitizedNewContent,
            current_content: sanitizedNewContent,
            updated_at: new Date().toISOString(),
          })
          .eq("id", element.id)
          .eq("site_id", siteId);

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
      errors.push(
        `Failed to process ${operation.element_id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { successful, failed, errors, updatedElements };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operationId = searchParams.get("operationId");
    const siteId = searchParams.get("siteId");

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (operationId) {
      // Get specific operation status
      const { data: operation, error } = await supabase
        .from("bulk_operations")
        .select("*")
        .eq("id", operationId)
        .eq("user_id", user.id)
        .single();

      if (error || !operation) {
        return NextResponse.json(
          { error: "Operation not found" },
          { status: 404 },
        );
      }

      return NextResponse.json(operation);
    } else if (siteId) {
      // Get all bulk update operations for the site
      const { data: operations, error } = await supabase
        .from("bulk_operations")
        .select("*")
        .eq("operation_type", "batch_update")
        .eq("site_id", siteId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }

      return NextResponse.json(operations || []);
    } else {
      return NextResponse.json(
        { error: "Missing operationId or siteId parameter" },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("Get bulk update operations error:", error);
    return NextResponse.json(
      { error: "Failed to get operations" },
      { status: 500 },
    );
  }
}
