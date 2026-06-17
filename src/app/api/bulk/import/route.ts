import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BulkImportPayload,
  ContentElement,
  ContentElementMetadata,
} from "@/types";
import { v4 as uuidv4 } from "uuid";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

export async function POST(req: NextRequest) {
  try {
    const body: BulkImportPayload = await req.json();
    const { site_id, format, data, options } = body;

    if (!site_id || !format || !data) {
      return NextResponse.json(
        { error: "Missing required fields: site_id, format, data" },
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

    // Create bulk operation record
    const operationId = uuidv4();
    const { error: operationError } = await supabase
      .from("bulk_operations")
      .insert({
        id: operationId,
        user_id: user.id,
        site_id,
        operation_type: "import",
        status: "running",
        configuration: { format, options },
        created_at: new Date().toISOString(),
      });

    if (operationError) {
      throw operationError;
    }

    // Process import data based on format
    let contentElements: Partial<ContentElement>[] = [];

    try {
      switch (format) {
        case "json":
          // data is unknown; runtime validation happens inside parseJSONImport
          contentElements = parseJSONImport(data as unknown[]);
          break;
        case "csv":
          if (typeof data !== "string") {
            throw new Error("CSV import requires data to be a string");
          }
          contentElements = parseCSVImport(data);
          break;
        case "xml":
          contentElements = parseXMLImport(data as string);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      // Validate content elements
      const validatedElements = await validateContentElements(
        contentElements,
        site_id,
        options,
        supabase,
      );

      // Import content elements
      const results = await importContentElements(
        validatedElements,
        site_id,
        user.id,
        options,
        supabase,
      );

      // Update operation status
      await supabase
        .from("bulk_operations")
        .update({
          status: "completed",
          total_items: contentElements.length,
          processed_items: results.successful,
          failed_items: results.failed,
          result_data: {
            successful_imports: results.successful,
            failed_imports: results.failed,
            errors: results.errors,
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", operationId);

      return NextResponse.json({
        operation_id: operationId,
        status: "completed",
        results: {
          total: contentElements.length,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
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
    console.error("Bulk import error:", error);
    return NextResponse.json(
      { error: "Failed to process bulk import" },
      { status: 500 },
    );
  }
}

function parseJSONImport(data: unknown[]): Partial<ContentElement>[] {
  if (!Array.isArray(data)) {
    throw new Error("JSON data must be an array");
  }

  return data.map((rawItem, index) => {
    const item = rawItem as Record<string, unknown>;
    if (!item["element_id"] || !item["selector"] || !item["current_content"]) {
      throw new Error(
        `Invalid item at index ${index}: missing required fields`,
      );
    }

    return {
      element_id: item["element_id"] as string,
      selector: item["selector"] as string,
      original_content: (item["original_content"] as string) || "",
      current_content: item["current_content"] as string,
      language: (item["language"] as string) || "en",
      variant: (item["variant"] as string) || "default",
      metadata: (item["metadata"] as ContentElementMetadata) || {},
    };
  });
}

function parseCSVImport(data: string): Partial<ContentElement>[] {
  const lines = data.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());

  const requiredHeaders = ["element_id", "selector", "current_content"];
  const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

  if (missingHeaders.length > 0) {
    throw new Error(
      `Missing required CSV headers: ${missingHeaders.join(", ")}`,
    );
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split(",").map((v) => v.trim());
    const item: Record<string, string> = {};

    headers.forEach((header, i) => {
      item[header] = values[i] || "";
    });

    if (!item.element_id || !item.selector || !item.current_content) {
      throw new Error(
        `Invalid CSV row at line ${index + 2}: missing required fields`,
      );
    }

    return {
      element_id: item.element_id,
      selector: item.selector,
      original_content: item.original_content || "",
      current_content: item.current_content,
      language: item.language || "en",
      variant: item.variant || "default",
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
    };
  });
}

function parseXMLImport(data: string): Partial<ContentElement>[] {
  // Basic XML parsing - in production, use a proper XML parser
  throw new Error("XML import not yet implemented");
}

async function validateContentElements(
  elements: Partial<ContentElement>[],
  siteId: string,
  options: BulkImportPayload["options"],
  supabase: SupabaseClient,
): Promise<Partial<ContentElement>[]> {
  const validatedElements: Partial<ContentElement>[] = [];

  for (const element of elements) {
    // Basic validation
    if (!element.element_id || !element.selector || !element.current_content) {
      continue;
    }

    // Content validation if requested
    if (options.validate_content) {
      // Add content validation logic here
      // e.g., HTML validation, length checks, etc.
    }

    // Check if element exists if not creating missing
    if (!options.create_missing_elements) {
      const { data: existingElement } = await supabase
        .from("content_elements")
        .select("id")
        .eq("site_id", siteId)
        .eq("element_id", element.element_id)
        .eq("language", element.language || "en")
        .eq("variant", element.variant || "default")
        .single();

      if (!existingElement) {
        continue; // Skip if element doesn't exist and not creating
      }
    }

    validatedElements.push({
      ...element,
      site_id: siteId,
    });
  }

  return validatedElements;
}

async function importContentElements(
  elements: Partial<ContentElement>[],
  siteId: string,
  userId: string,
  options: BulkImportPayload["options"],
  supabase: SupabaseClient,
): Promise<{ successful: number; failed: number; errors: string[] }> {
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const element of elements) {
    try {
      // Sanitize user-supplied content fields before writing to DB (XSS prevention)
      const sanitizedCurrentContent = sanitizeHTML(
        element.current_content!,
        "RICH_TEXT",
      );
      const sanitizedOriginalContent = sanitizeHTML(
        element.original_content || "",
        "RICH_TEXT",
      );

      const elementData = {
        site_id: siteId,
        element_id: element.element_id!,
        selector: element.selector!,
        original_content: sanitizedOriginalContent,
        current_content: sanitizedCurrentContent,
        language: element.language || "en",
        variant: element.variant || "default",
        metadata: element.metadata || {},
        updated_at: new Date().toISOString(),
      };

      if (options.overwrite_existing) {
        // Upsert operation
        const { error } = await supabase
          .from("content_elements")
          .upsert(elementData, {
            onConflict: "site_id,element_id,language,variant",
          });

        if (error) throw error;
      } else {
        // Insert only
        const { error } = await supabase
          .from("content_elements")
          .insert(elementData);

        if (error) {
          if (error.code === "23505") {
            // Unique constraint violation
            errors.push(`Element ${element.element_id} already exists`);
            failed++;
            continue;
          }
          throw error;
        }
      }

      successful++;
    } catch (error) {
      failed++;
      errors.push(
        `Failed to import ${element.element_id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { successful, failed, errors };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operationId = searchParams.get("operationId");

    if (!operationId) {
      return NextResponse.json(
        { error: "Missing operationId parameter" },
        { status: 400 },
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
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get operation status
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
  } catch (error) {
    console.error("Get operation status error:", error);
    return NextResponse.json(
      { error: "Failed to get operation status" },
      { status: 500 },
    );
  }
}
