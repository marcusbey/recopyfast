"use client";

/**
 * The editor hub: email -> code -> pick a site -> land on it in edit mode.
 *
 * Lives under `src/app/edit/` rather than `src/components/` because the whole
 * flow is specific to this one route and shares no state with the app shell —
 * the person using it is usually not a ReCopyFast account holder at all.
 *
 * Two rules govern everything rendered here:
 *   1. Never reveal whether an address is known. The "check your email" panel
 *      is shown for every well-formed address, and the site list is only
 *      fetched after a code has been accepted.
 *   2. Never hold a secret longer than the step that needs it. The code is
 *      cleared as soon as it is submitted; the grant never touches this origin.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, Globe, Loader2, Mail, ShieldCheck } from "lucide-react";

interface EditorSite {
  siteId: string;
  name: string;
  domain: string;
  permissions: string[];
}

type Step = "email" | "code" | "sites";

const CODE_LENGTH = 6;

export function EditorSignIn() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [sites, setSites] = useState<EditorSite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [handingOffTo, setHandingOffTo] = useState<string | null>(null);

  const inFlight = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address to continue.");
      return;
    }

    inFlight.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/editor/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await response.json();

      if (!response.ok) {
        // 503 means we genuinely could not send — say so rather than showing a
        // "check your email" panel for mail that will never arrive.
        setError(
          data?.message ?? "We couldn't send the code. Please try again.",
        );
        return;
      }

      // Reached for every well-formed address, known or not.
      setStep("code");
      setNotice(data?.message ?? null);
    } catch {
      setError("We couldn't reach the server. Check your connection.");
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    if (code.trim().length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }

    inFlight.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/editor/submit-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.message ?? "That code isn't valid. Request a new one.");
        return;
      }

      const returned: EditorSite[] = data?.sites ?? [];
      setSites(returned);
      setStep("sites");
      setNotice(null);
    } catch {
      setError("We couldn't reach the server. Check your connection.");
    } finally {
      // The code is single-use and now spent either way.
      setCode("");
      inFlight.current = false;
      setIsLoading(false);
    }
  }

  async function openSite(site: EditorSite) {
    if (inFlight.current) return;

    inFlight.current = true;
    setHandingOffTo(site.siteId);
    setError(null);

    try {
      const response = await fetch("/api/editor/handoff/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: site.siteId, rememberDevice }),
      });
      const data = await response.json();

      if (!response.ok || !data?.redirectUrl) {
        setError(data?.message ?? "We couldn't open that site. Try again.");
        return;
      }

      // The code in this URL is single-use and expires in 60 seconds, so it is
      // safe in history; the widget spends it and strips it on arrival.
      window.location.href = data.redirectUrl;
    } catch {
      setError("We couldn't reach the server. Check your connection.");
    } finally {
      inFlight.current = false;
      setHandingOffTo(null);
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <header className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tone-accent-surface">
          <ShieldCheck
            className="h-6 w-6 text-tone-accent-text"
            aria-hidden="true"
          />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">
          Edit your site
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in with the email address the site owner added you with.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === "email" && (
        <form onSubmit={requestCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="editor-email">Email address</Label>
            <Input
              id="editor-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Sending code
              </>
            ) : (
              "Send me a code"
            )}
          </Button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-4" noValidate>
          <div className="rounded-lg bg-surface-1 p-4 text-center">
            <Mail
              className="mx-auto mb-2 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-foreground">
              {notice ??
                "If that address can edit a site, a code is on its way."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sent to <span className="font-medium">{email.trim()}</span>. It
              expires in 10 minutes.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="editor-code">6-digit code</Label>
            <Input
              id="editor-code"
              ref={codeInputRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              placeholder="000000"
              className="text-center text-2xl tracking-[0.5em]"
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
                )
              }
              disabled={isLoading}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              disabled={isLoading}
            />
            Remember this browser for 7 days
          </label>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Checking
              </>
            ) : (
              "Continue"
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setNotice(null);
            }}
            disabled={isLoading}
          >
            Use a different address
          </Button>
        </form>
      )}

      {step === "sites" && (
        <div className="space-y-4">
          {sites.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center">
              <Globe
                className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <h2 className="text-base font-medium text-foreground">
                No sites yet
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {email.trim()} isn&apos;t set up to edit anything. Ask the site
                owner to add this address.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-medium text-muted-foreground">
                Choose a site to edit
              </h2>
              <ul className="space-y-2">
                {sites.map((site) => (
                  <li key={site.siteId}>
                    <button
                      type="button"
                      onClick={() => openSite(site)}
                      disabled={handingOffTo !== null}
                      className="flex w-full items-center justify-between rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {site.name}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {site.domain}
                        </span>
                      </span>
                      {handingOffTo === site.siteId ? (
                        <Loader2
                          className="h-5 w-5 shrink-0 animate-spin text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight
                          className="h-5 w-5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
