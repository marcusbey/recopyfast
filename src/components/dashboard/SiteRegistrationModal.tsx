"use client";

import { Fragment, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import { StatusBadge, siteStatuses } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { installRecipes } from "@/lib/sites/install-recipes";
import { Loader2, AlertCircle, ExternalLink } from "lucide-react";

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
  const [isExampleOpen, setIsExampleOpen] = useState(false);

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

  const handleClose = () => {
    setFormData({ name: "", domain: "" });
    setErrors({});
    setRegistrationResult(null);
    setIsExampleOpen(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[40rem]">
        {!registrationResult ? (
          <>
            <DialogHeader>
              <DialogTitle>Register New Site</DialogTitle>
              <DialogDescription>
                Add a new website to start making your content editable with AI
                assistance.
              </DialogDescription>
            </DialogHeader>

            {/* The form spans body and footer, so it must be the flex region
                itself; otherwise DialogBody stops being a direct flex child
                and the whole form overflows the frame. */}
            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <DialogBody className="space-y-6">
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
                    Website Name{" "}
                    <span className="text-tone-danger-text">*</span>
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
                    <p className="text-sm text-tone-danger-text">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="domain"
                    className="text-foreground font-medium"
                  >
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
              </DialogBody>

              <DialogFooter>
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
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            {/* s66a, design § 1. The old success screen was a centred 48px
                circle, a Title-Case "Site Registered Successfully!" and an
                unwrapped <pre>: inside the old grid dialog the header centred
                itself in a 2,524px track, off-screen, and the only Copy button
                sat 2,000px to the right (s66 research, fact 1). */}
            <DialogHeader>
              <DialogTitle>Site registered</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-foreground">
                    {registrationResult.site.name}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {registrationResult.site.domain}
                  </span>
                  <StatusBadge status={siteStatuses["awaiting-install"]} />
                </div>
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              <ol className="space-y-6">
                <InstallStep number={1} title="Copy the snippet">
                  <CodeBlock
                    value={registrationResult.embedScript}
                    label="HTML"
                    copyLabel="Copy snippet"
                  />
                </InstallStep>

                {/* The same recipes, in the same words, as the site's
                    Installation card: the product used to describe
                    installation two different ways. */}
                <InstallStep
                  number={2}
                  title={
                    <>
                      Paste it before{" "}
                      <code className="font-mono">&lt;/body&gt;</code>
                    </>
                  }
                >
                  <Tabs defaultValue={installRecipes[0].id}>
                    <TabsList aria-label="Platform">
                      {installRecipes.map((recipe) => (
                        <TabsTrigger key={recipe.id} value={recipe.id}>
                          {recipe.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {installRecipes.map((recipe) => (
                      <TabsContent
                        key={recipe.id}
                        value={recipe.id}
                        className="mt-3 space-y-2 text-sm"
                      >
                        <p className="text-foreground">{recipe.location}</p>
                        {recipe.notes && (
                          <p className="text-muted-foreground">
                            {recipe.notes}
                          </p>
                        )}
                      </TabsContent>
                    ))}
                  </Tabs>
                </InstallStep>

                <InstallStep
                  number={3}
                  title="Open your site — text is editable by itself"
                >
                  {/*
                    These instructions used to tell people to add a
                    `data-recopyfast-editable` attribute. No such attribute
                    exists anywhere in the product: the widget discovers text by
                    tag name and only reads data-rcf-content / data-rcf-ignore.
                    Anyone who followed the old steps literally got nothing.
                  */}
                  <p className="text-sm text-muted-foreground">
                    The widget finds headings, paragraphs, list items, table
                    cells, labels, buttons and images by itself — no markup
                    changes.
                  </p>
                  {/* Ruled rows, per the design: a hairline above the list
                      and under every row. Below 640px the term stacks
                      above its value, with one rule under the pair. */}
                  <dl className="grid grid-cols-1 border-t border-border text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
                    {ATTRIBUTE_ROWS.map(({ term, value }) => (
                      <Fragment key={term}>
                        <dt className="pt-2 text-muted-foreground sm:border-b sm:border-border sm:pb-2">
                          {term}
                        </dt>
                        <dd className="min-w-0 border-b border-border pb-2 pt-0.5 sm:pt-2">
                          <code className="rounded-control bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                            {value}
                          </code>
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
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
                    navigation by accident.
                  </p>
                  {/* Rendered only while open: a closed <details> still holds
                      its children in the DOM, and a second always-present
                      "Copy" button would make the snippet's ambiguous. */}
                  <details
                    onToggle={(event) =>
                      setIsExampleOpen(event.currentTarget.open)
                    }
                  >
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      Show example
                    </summary>
                    {isExampleOpen && (
                      <CodeBlock
                        className="mt-2"
                        label="HTML"
                        wrap={false}
                        value={INSTALL_EXAMPLE}
                        copyLabel="Copy example"
                      />
                    )}
                  </details>
                </InstallStep>
              </ol>
            </DialogBody>

            <DialogFooter className="flex-col sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-eyebrow">Site ID</span>
                <code className="min-w-0 select-all font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                  {registrationResult.site.id}
                </code>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                {/* An honest external-link icon: this one does open
                    elsewhere. "Go to Site Dashboard" carried the same icon
                    while only closing the dialog, so it is gone. */}
                <a
                  href="/docs/install"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Installation guide
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="max-sm:w-full"
                >
                  Close
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The attributes the widget honours (step 3), as the site-registered panel
 * lists them. Inline code, so 12px mono: 13px is for code inside CodeBlock
 * (design system, Typography).
 */
const ATTRIBUTE_ROWS = [
  { term: "Exclude", value: "data-rcf-ignore" },
  { term: "Opt in", value: "data-rcf-content" },
  { term: "Opt in a link", value: 'class="rcf-editable-link"' },
] as const;

const INSTALL_EXAMPLE = `<h1>Edited automatically</h1>
<p data-rcf-ignore>Never editable</p>
<div data-rcf-content>Opt this container in</div>
<a href="/pricing" class="rcf-editable-link">Opt this link in</a>`;

interface InstallStepProps {
  number: number;
  title: React.ReactNode;
  children: React.ReactNode;
}

/** One numbered step: a square step number, a heading, then its content. */
function InstallStep({ number, title, children }: InstallStepProps) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-container border border-border bg-surface-1 text-xs font-medium text-foreground"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="text-sm font-semibold leading-6 text-foreground">
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}
