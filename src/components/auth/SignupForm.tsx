"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Mail, User } from "lucide-react";
import { getAuthErrorMessage, logAuthError } from "./auth-errors";

interface SignupFormProps {
  onSwitchToLogin?: () => void;
}

export function SignupForm({ onSwitchToLogin }: SignupFormProps) {
  const { signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const inFlightRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email address to continue.");
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setIsLoading(true);

    try {
      // The name field was previously collected and thrown away; pass it
      // through so it lands on the user's metadata at signup.
      await signInWithMagicLink(trimmedEmail, {
        name: name.trim() || undefined,
      });
      // Show the "check your email" panel rather than signalling success to a
      // parent. Nothing has actually succeeded yet — the user is only signed in
      // once they click the emailed link.
      setSuccess(true);
    } catch (err: unknown) {
      logAuthError("signup magic link", err);
      setError(getAuthErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-tone-success-surface rounded-full flex items-center justify-center mx-auto">
          <Mail className="w-8 h-8 text-tone-success-text" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            Check your email
          </h3>
          <p className="text-muted-foreground text-sm">
            We&apos;ve sent a magic link to{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
          <p className="text-muted-foreground text-xs">
            Click the link in your email to create your account and sign in. You
            can close this window.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setSuccess(false)}
          className="mt-4"
        >
          Try different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="pl-10"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name (optional)</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="pl-10"
            disabled={isLoading}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={isLoading || !email}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending magic link...
          </>
        ) : (
          <>
            <Mail className="mr-2 h-4 w-4" />
            Send magic link
          </>
        )}
      </Button>

      <div className="text-center text-sm text-muted-foreground">
        <p>We&apos;ll send you a secure link to create your account</p>
      </div>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Already have an account? </span>
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-primary hover:underline font-medium"
        >
          Sign in
        </button>
      </div>
    </form>
  );
}
