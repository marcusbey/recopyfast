import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { AlertCircle } from "lucide-react";
import Link from "next/link";

// Reached only from a failed sign-in link; nothing here belongs in a search
// index (s88). robots.txt also disallows /auth/, because /auth/confirm spends a
// one-time token from its query string.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <IconTile tone="danger" size="lg" className="mx-auto mb-4 flex">
            <AlertCircle />
          </IconTile>
          {/* The page's one h1 (ADR 053 §3); it was an h3 CardTitle. */}
          <h1 className="text-page-title">Authentication error</h1>
          <CardDescription>
            There was a problem with your authentication request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            This could be due to an expired link or an invalid authentication
            code. Please try signing in again.
          </p>

          <div className="flex flex-col gap-3">
            <Button className="w-full" asChild>
              {/* /auth/error is static; /login must establish a nonce document. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/login">Back to login</a>
            </Button>

            <Link href="/">
              <Button variant="outline" className="w-full">
                Go to homepage
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
