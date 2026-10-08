"use client";

import { SignupForm } from "@/components/auth/SignupForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Code } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center justify-center space-x-3 mb-8"
        >
          <div className="w-12 h-12 bg-primary rounded-container flex items-center justify-center">
            <Code className="w-7 h-7 text-primary-foreground" />
          </div>
          <span className="font-semibold text-2xl text-foreground tracking-tight">
            ReCopyFast
          </span>
        </Link>

        <Card>
          <CardHeader className="text-center">
            {/* The page's one h1 (ADR 053 §3); it was an h3 CardTitle. */}
            <h1 className="text-page-title">Create your account</h1>
            <CardDescription>
              Get started with ReCopyFast in just a few seconds
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm onSwitchToLogin={() => router.push("/login")} />
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
