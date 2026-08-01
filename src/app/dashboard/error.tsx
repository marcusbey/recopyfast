"use client";

/**
 * Error boundary for the dashboard segment. Renders inside `dashboard/layout.tsx`,
 * so the sidebar and header stay usable and the recovery actions stay in-context.
 *
 * Next.js catches the error here instead of letting it reach Sentry's global
 * handler, so the exception is reported explicitly.
 * See https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/
 * ("Error Boundaries").
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, LayoutDashboard, RefreshCcw } from "lucide-react";

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Card className="border-tone-danger-border bg-tone-danger-surface">
      <CardContent className="p-8">
        <div className="flex items-start space-x-4">
          <div className="w-12 h-12 bg-tone-danger-surface rounded-full flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-6 h-6 text-tone-danger-text" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              This page couldn&apos;t be loaded
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Something went wrong while rendering this part of your dashboard.
              The error has been reported to our team.
            </p>

            {process.env.NODE_ENV === "development" && (
              <p className="text-xs font-mono text-foreground break-all bg-card border border-tone-danger-border rounded-md p-3 mb-6">
                {error.message}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={reset} className="bg-primary">
                <RefreshCcw className="w-4 h-4 mr-2" />
                Try again
              </Button>
              <Link href="/dashboard">
                <Button variant="outline">
                  <LayoutDashboard className="w-4 h-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </div>

            {error.digest && (
              <p className="text-xs text-muted-foreground mt-6">
                Error ID: <span className="font-mono">{error.digest}</span>
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
