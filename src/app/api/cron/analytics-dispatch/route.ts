import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";
import { dispatchAnalytics } from "@/lib/analytics/google-analytics/delivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await dispatchAnalytics());
  } catch {
    console.error("[analytics/delivery] dispatch unavailable");
    return NextResponse.json(
      { error: "Analytics dispatch unavailable" },
      { status: 503 },
    );
  }
}
