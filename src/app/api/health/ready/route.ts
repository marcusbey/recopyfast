/**
 * Readiness Check API Endpoint
 * Verifies if the application is ready to serve traffic
 *
 * Anonymous, like `/api/health`, so each check answers pass/fail and nothing
 * else (s84, s69 L3). It used to name the missing environment variables, echo
 * the raw database and storage errors and print the Vercel region. The detail
 * is logged here instead; never add a `message` back to `ReadinessCheck`.
 */

import { NextRequest, NextResponse } from "next/server";
import { limitHealthProbe } from "@/lib/api/health-rate-limit";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/monitoring/logger";

interface ReadinessCheck {
  name: string;
  status: "pass" | "fail";
  critical: boolean;
}

interface ReadinessResponse {
  ready: boolean;
  timestamp: string;
  checks: ReadinessCheck[];
  details?: {
    version: string;
    environment: string;
  };
}

async function checkEnvironmentVariables(): Promise<ReadinessCheck> {
  const requiredVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    // The names are for the operator. On the wire they would tell anyone which
    // credential this deployment is running without.
    logger.error(
      "Readiness: required environment variables are missing",
      undefined,
      undefined,
      { component: "readiness-check", missing: missingVars },
    );
    return {
      name: "environment_variables",
      status: "fail",
      critical: true,
    };
  }

  return {
    name: "environment_variables",
    status: "pass",
    critical: true,
  };
}

async function checkDatabaseConnection(): Promise<ReadinessCheck> {
  try {
    const supabase = await createClient();

    // Readiness is polled without a user session. Probing `sites` coupled this
    // check to tenant ACLs and turned the s38 credential lockdown into a false
    // database outage. The active-plan catalogue is explicitly readable by
    // anon, so this narrow query still exercises PostgREST and Postgres while
    // keeping tenant tables closed.
    const { error } = await supabase.from("plans").select("id").limit(1);

    if (error) {
      throw error;
    }

    return {
      name: "database_connection",
      status: "pass",
      critical: true,
    };
  } catch (error) {
    logger.error(
      "Readiness: database check failed",
      error as Error,
      undefined,
      { component: "readiness-check", check: "database_connection" },
    );
    return {
      name: "database_connection",
      status: "fail",
      critical: true,
    };
  }
}

async function checkStorageAccess(): Promise<ReadinessCheck> {
  try {
    const supabase = await createClient();

    // Check if we can access storage
    const { error } = await supabase.storage.listBuckets();

    if (error) {
      throw error;
    }

    return {
      name: "storage_access",
      status: "pass",
      critical: false,
    };
  } catch (error) {
    logger.error("Readiness: storage check failed", error as Error, undefined, {
      component: "readiness-check",
      check: "storage_access",
    });
    return {
      name: "storage_access",
      status: "fail",
      critical: false,
    };
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Same per-IP bucket as `/api/health`, before any check. Fails open: see
  // `limitHealthProbe`.
  const limited = await limitHealthProbe(request);
  if (limited) return limited;

  try {
    // Run all readiness checks
    const checks = await Promise.all([
      checkEnvironmentVariables(),
      checkDatabaseConnection(),
      checkStorageAccess(),
    ]);

    // Determine if app is ready
    const criticalChecksPassed = checks
      .filter((check) => check.critical)
      .every((check) => check.status === "pass");

    const ready = criticalChecksPassed;

    const response: ReadinessResponse = {
      ready,
      timestamp: new Date().toISOString(),
      checks,
      details: {
        version: process.env.npm_package_version || "1.0.0",
        environment:
          process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      },
    };

    // Log readiness check
    logger.info("Readiness check completed", undefined, {
      component: "readiness-check",
      duration: Date.now() - startTime,
      ready,
      failedChecks: checks
        .filter((c) => c.status === "fail")
        .map((c) => c.name),
    });

    return NextResponse.json(response, {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    logger.error("Readiness check failed", error as Error, undefined, {
      component: "readiness-check",
    });

    return NextResponse.json(
      {
        ready: false,
        timestamp: new Date().toISOString(),
        error: "Readiness check failed",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  }
}
