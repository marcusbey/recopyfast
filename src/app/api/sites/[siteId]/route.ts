import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { siteId } = await context.params;
    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();

    // Authenticate the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the user is the creator. Invited managers map to permission
    // "admin" (teamRoleToSitePermission), so admin alone is not enough —
    // they could wipe the tenant. The creator's row is the one written at
    // registration without granted_by (sites/register + share A-4).
    const { data: permission, error: permissionError } = await serviceClient
      .from("site_permissions")
      .select("permission, granted_by")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (permissionError || !permission) {
      return NextResponse.json(
        { error: "Site not found or insufficient permissions" },
        { status: 403 },
      );
    }

    if (permission.permission !== "admin" || permission.granted_by !== null) {
      return NextResponse.json(
        { error: "Only the site creator can delete this site" },
        { status: 403 },
      );
    }

    // Delete the site and let the schema cascade the rest.
    //
    // Order is the whole fix here, not just atomicity. This used to delete every
    // `site_permissions` row first and the `sites` row second, as two statements
    // PostgREST cannot wrap in a transaction. When the second one failed, the
    // first was already committed and the two halves disagreed in the worst
    // possible direction: the caller could no longer see the site — the `sites`
    // SELECT policy authorises *through* `site_permissions` — so they could
    // neither retry this delete nor edit it, while the widget kept serving its
    // content, because the widget authorises on the site token and not on
    // permissions. The site stayed live on the public internet owned by nobody,
    // and the permission check above answered 403 on every retry.
    //
    // Deleting `sites` first inverts that. `site_permissions.site_id`,
    // `content_elements.site_id` and `content_history.content_element_id` are all
    // ON DELETE CASCADE (20250817000000_complete_database_setup.sql:55, :28, :44),
    // so one statement removes the whole tree and a failure leaves every row
    // exactly where it was — including the permission row that lets the caller
    // try again.
    //
    // That cascade only actually completes because
    // 20260809130000_content_history_definer_and_delete_split.sql moved the
    // content-history DELETE branch onto a BEFORE DELETE trigger. While it was
    // AFTER DELETE its history insert violated the very FK that cascades here, so
    // this statement failed for any site holding content — which is every site a
    // widget was ever installed on (A-35).
    const { error: deleteSiteError } = await serviceClient
      .from("sites")
      .delete()
      .eq("id", siteId);

    if (deleteSiteError) {
      console.error("Error deleting site:", deleteSiteError);
      return NextResponse.json(
        { error: "Failed to delete site" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { message: "Site deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in DELETE /api/sites/[siteId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
