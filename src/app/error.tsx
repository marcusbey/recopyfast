"use client";

/**
 * Route-level error boundary for every segment under `app/` that does not
 * declare its own `error.tsx`.
 *
 * Next.js catches the error here instead of letting it reach Sentry's global
 * handler, so the exception is reported explicitly.
 * See https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/
 * ("Error Boundaries").
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, RefreshCcw } from "lucide-react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-gray-200 shadow-lg">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Something went wrong
          </CardTitle>
          <CardDescription>
            This page couldn&apos;t be loaded. The error has been reported to
            our team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {process.env.NODE_ENV === "development" && (
            <p className="text-xs font-mono text-gray-700 break-all bg-gray-100 rounded-md p-3">
              {error.message}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <Button
              onClick={reset}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              <RefreshCcw className="w-4 h-4 mr-2" />
              Try again
            </Button>

            <Link href="/">
              <Button variant="outline" className="w-full">
                <Home className="w-4 h-4 mr-2" />
                Go to Homepage
              </Button>
            </Link>
          </div>

          {error.digest && (
            <p className="text-xs text-gray-500 text-center">
              If the problem persists, contact support with error ID:{" "}
              <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
