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

    // Verify the user has admin permission on this site
    const { data: permission, error: permissionError } = await serviceClient
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (permissionError || !permission) {
      return NextResponse.json(
        { error: "Site not found or insufficient permissions" },
        { status: 403 },
      );
    }

    if (permission.permission !== "admin") {
      return NextResponse.json(
        { error: "Only site admins can delete sites" },
        { status: 403 },
      );
    }

    // Delete site permissions first (foreign key constraint)
    const { error: deletePermissionsError } = await serviceClient
      .from("site_permissions")
      .delete()
      .eq("site_id", siteId);

    if (deletePermissionsError) {
      console.error("Error deleting site permissions:", deletePermissionsError);
      return NextResponse.json(
        { error: "Failed to delete site permissions" },
        { status: 500 },
      );
    }

    // Delete the site
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
