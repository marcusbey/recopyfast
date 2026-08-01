import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { checkTestCompletion } from "@/lib/ab-testing/lifecycle";

// Cron endpoint: checks all active A/B tests for completion.
// Configured to run every 5 minutes via Vercel cron.
// vercel.json crons config: path="/api/cron/ab-test-lifecycle", schedule="every 5 min"
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    // Get all active tests
    const { data: activeTests, error } = await supabase
      .from("ab_tests")
      .select("id, end_date")
      .eq("status", "active");

    if (error) {
      console.error("Cron: error fetching active tests:", error);
      return NextResponse.json(
        { error: "Failed to fetch active tests" },
        { status: 500 },
      );
    }

    if (!activeTests || activeTests.length === 0) {
      return NextResponse.json({ checked: 0, message: "No active tests" });
    }

    // Check each test for completion
    let completed = 0;
    const errors: string[] = [];

    for (const test of activeTests) {
      try {
        await checkTestCompletion(test.id);

        // Check if it was completed
        const { data: updated } = await supabase
          .from("ab_tests")
          .select("status")
          .eq("id", test.id)
          .single();

        if (updated?.status === "completed") {
          completed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Test ${test.id}: ${msg}`);
        console.error(`Cron: error checking test ${test.id}:`, err);
      }
    }

    return NextResponse.json({
      checked: activeTests.length,
      completed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Cron ab-test-lifecycle error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
