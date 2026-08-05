"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, Copy, Loader2, AlertCircle, ExternalLink } from "lucide-react";

interface SiteRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * A site now exists. Fired once, as soon as the API confirms it — not when
   * the dialog is dismissed — so the page underneath is already correct by the
   * time the success screen appears, whichever way the owner leaves it.
   */
  onSuccess?: () => void;
}

interface FormData {
  name: string;
  domain: string;
}

interface FormErrors {
  name?: string;
  domain?: string;
  general?: string;
}

interface RegistrationResponse {
  site: {
    id: string;
    domain: string;
    name: string;
    created_at: string;
  };
  apiKey: string;
  siteToken: string;
  embedScript: string;
}

export function SiteRegistrationModal({
  isOpen,
  onClose,
  onSuccess,
}: SiteRegistrationModalProps) {
  const [formData, setFormData] = useState<FormData>({
    name: "",
    domain: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [registrationResult, setRegistrationResult] =
    useState<RegistrationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const validateUrl = (url: string): boolean => {
    try {
      const urlString = url.startsWith("http") ? url : `https://${url}`;
      const urlObj = new URL(urlString);
      return !!urlObj.hostname;
    } catch {
      return false;
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Website name is required";
    }

    if (!formData.domain.trim()) {
      newErrors.domain = "Website URL is required";
    } else if (!validateUrl(formData.domain)) {
      newErrors.domain =
        "Please enter a valid domain (e.g., example.com or https://example.com)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await fetch("/api/sites/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          domain: formData.domain.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 400 &&
          data.error === "Domain already registered"
        ) {
          setErrors({ domain: "This domain is already registered" });
        } else {
          setErrors({ general: data.error || "Failed to register site" });
        }
        return;
      }

      setRegistrationResult(data);
      // Before the modal shows anything, tell the parent the list is stale.
      // Deferring this to the footer button left "0 active sites / No sites
      // connected yet" sitting behind "Site Registered Successfully!".
      onSuccess?.();
    } catch {
      setErrors({ general: "An unexpected error occurred. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyScript = async () => {
    if (!registrationResult) return;

    try {
      await navigator.clipboard.writeText(registrationResult.embedScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleClose = () => {
    setFormData({ name: "", domain: "" });
    setErrors({});
    setRegistrationResult(null);
    setCopied(false);
    onClose();
  };

  // `onSuccess` already fired at registration, so this is only a dismissal.
  const handleGoToDashboard = () => {
    handleClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] bg-card border border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        {!registrationResult ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-foreground">
                Register New Site
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Add a new website to start making your content editable with AI
                assistance.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              {errors.general && (
                <Alert
                  variant="destructive"
                  className="bg-tone-danger-surface border-tone-danger-border"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-tone-danger-text">
                    {errors.general}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="name" className="text-foreground font-medium">
                  Website Name <span className="text-tone-danger-text">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="My Awesome Website"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    if (errors.name) {
                      setErrors({ ...errors, name: undefined });
                    }
                  }}
                  className={
                    errors.name
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                  disabled={isLoading}
                />
                {errors.name && (
                  <p className="text-sm text-tone-danger-text">{errors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="domain" className="text-foreground font-medium">
                  Website URL <span className="text-tone-danger-text">*</span>
                </Label>
                <Input
                  id="domain"
                  placeholder="example.com or https://example.com"
                  value={formData.domain}
                  onChange={(e) => {
                    setFormData({ ...formData, domain: e.target.value });
                    if (errors.domain) {
                      setErrors({ ...errors, domain: undefined });
                    }
                  }}
                  className={
                    errors.domain
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                  disabled={isLoading}
                />
                {errors.domain && (
                  <p className="text-sm text-tone-danger-text">
                    {errors.domain}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Enter your website&apos;s domain name (e.g., example.com)
                </p>
              </div>

              {/* The Description field that used to sit here was never sent to
                  /api/sites/register, and `sites` has no column to hold it —
                  every description typed in was discarded on submit. Removed
                  rather than faked. */}

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="bg-primary"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    "Register Site"
                  )}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="w-12 h-12 bg-tone-success-surface rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-tone-success-text" />
              </div>
              <DialogTitle className="text-2xl font-bold text-foreground text-center">
                Site Registered Successfully!
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-center">
                Your website has been registered. Follow the steps below to
                integrate ReCopyFast.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-6">
              <div className="bg-surface-1 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-foreground">Site Details</h3>
                <div className="space-y-1 text-sm">
                  <p className="text-muted-foreground">
                    <span className="font-medium">Name:</span>{" "}
                    {registrationResult.site.name}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">Domain:</span>{" "}
                    {registrationResult.site.domain}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium">Site ID:</span>{" "}
                    <code className="bg-card px-2 py-0.5 rounded text-xs border border-border">
                      {registrationResult.site.id}
                    </code>
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-foreground">
                  Integration Instructions
                </h3>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground font-medium">
                    Step 1: Copy the embed script
                  </p>
                  <div className="relative">
                    {/* Was `bg-foreground text-foreground` — background and
                        text resolved to the same colour, so the snippet the
                        customer has to copy was invisible in both themes. */}
                    <pre className="bg-surface-2 text-foreground p-4 pr-24 rounded-lg text-xs overflow-x-auto">
                      <code>{registrationResult.embedScript}</code>
                    </pre>
                    <Button
                      size="sm"
                      variant="outline"
                      className="absolute top-2 right-2 bg-card hover:bg-surface-2"
                      onClick={handleCopyScript}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground font-medium">
                    Step 2: Add the script to your website
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Paste the script tag in your HTML, just before the closing{" "}
                    <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">
                      &lt;/body&gt;
                    </code>{" "}
                    tag.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground font-medium">
                    Step 3: That&apos;s it — your text is already editable
                  </p>
                  {/*
                    These instructions used to tell people to add a
                    `data-recopyfast-editable` attribute. No such attribute
                    exists anywhere in the product: the widget discovers text by
                    tag name and only reads data-rcf-content / data-rcf-ignore.
                    Anyone who followed the old steps literally got nothing.
                  */}
                  <p className="text-sm text-muted-foreground">
                    The widget finds your text automatically — headings,
                    paragraphs, list items, table cells, labels, buttons and
                    images all become editable with no markup changes.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    To exclude something, add{" "}
                    <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">
                      data-rcf-ignore
                    </code>
                    . To make a container editable that would not be picked up
                    on its own, add{" "}
                    <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">
                      data-rcf-content
                    </code>
                    .
                  </p>
                  {/*
                    Links are the one common element the widget deliberately
                    skips: the selector is `a.rcf-editable-link`, not `a`, so
                    that discovery cannot turn a site's whole navigation into
                    editable copy. Saying so here rather than only on the
                    marketing page — the register's F-12 asked for "the copy AND
                    docs", and this modal IS the docs for anyone installing.
                  */}
                  <p className="text-sm text-muted-foreground">
                    Links are skipped on purpose, so nobody can rewrite your
                    navigation by accident. Opt an individual link in with{" "}
                    <code className="bg-surface-2 px-1.5 py-0.5 rounded text-xs">
                      class=&quot;rcf-editable-link&quot;
                    </code>
                    .
                  </p>
                  <pre className="bg-surface-2 text-foreground p-3 rounded-lg text-xs overflow-x-auto">
                    <code>{`<h1>Edited automatically</h1>
<p data-rcf-ignore>Never editable</p>
<div data-rcf-content>Opt this container in</div>
<a href="/pricing" class="rcf-editable-link">Opt this link in</a>`}</code>
                  </pre>
                </div>

                <Alert className="bg-tone-info-surface border-tone-info-border">
                  <AlertDescription className="text-tone-info-text text-sm">
                    <strong>Need help?</strong> Visit your{" "}
                    <a
                      href="/dashboard/sites"
                      className="underline hover:text-tone-info-text"
                    >
                      site dashboard
                    </a>{" "}
                    to manage your integration.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                <Button onClick={handleGoToDashboard} className="bg-primary">
                  Go to Site Dashboard
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
