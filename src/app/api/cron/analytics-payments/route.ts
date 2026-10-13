import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";
import { reconcilePaymentAnalytics } from "@/lib/analytics/google-analytics/payment-reconciliation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await reconcilePaymentAnalytics());
  } catch {
    console.error("[analytics/payment] reconciliation unavailable");
    return NextResponse.json(
      { error: "Payment analytics unavailable" },
      { status: 503 },
    );
  }
}
