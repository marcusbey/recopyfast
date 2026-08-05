import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass, Home, LayoutDashboard } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-tone-accent-surface rounded-full flex items-center justify-center mx-auto mb-4">
            <Compass className="w-8 h-8 text-tone-accent-text" />
          </div>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            We couldn&apos;t find the page you were looking for.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            The link may be out of date, or the page may have been moved.
          </p>

          <div className="flex flex-col gap-3">
            <Link href="/">
              <Button className="w-full">
                <Home className="w-4 h-4 mr-2" />
                Go to homepage
              </Button>
            </Link>

            <Link href="/dashboard">
              <Button variant="outline" className="w-full">
                <LayoutDashboard className="w-4 h-4 mr-2" />
                Go to dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
