"use client";

import { useMemo } from "react";
import { Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { trackGoal } from "@/lib/analytics/datafast-client";
import type { DataFastInstallChoiceLocation } from "@/lib/analytics/datafast-goals";
import {
  DEVELOPER_GUIDE_PATH,
  buildDeveloperHandoffMessage,
  formatDeveloperHandoffForCopy,
  type DeveloperHandoffFailureReason,
  type MailtoBody,
} from "@/lib/sites/developer-handoff-message";

export interface DeveloperHandoffMessageProps {
  embedScript: string;
  siteDomain: string;
  location: DataFastInstallChoiceLocation;
}

/** Why the message was refused, in the owner's words, per refusal reason. */
const FAILURE_EXPLANATIONS: Record<DeveloperHandoffFailureReason, string> = {
  invalid_snippet:
    "This snippet doesn't look like the one ReCopyFast generates, so we won't put it in an email.",
  invalid_domain:
    "This site's address doesn't look like a plain domain (for example www.example.com), so we won't build an email around it.",
  credential_detected:
    "The message would have contained something that looks like a private key or a sign-in link, so we won't put it in an email.",
};

/** What the owner does after "Open in my email app", per draft content. */
const MAILTO_FALLBACK_HELP: Record<Exclude<MailtoBody, "full">, string> = {
  short:
    "Email links have a length limit, so your email app opens with a shorter version: the snippet and the guide link. Copy the message above and paste it where the draft says so.",
  none: "Email links have a length limit, and this snippet is too long to fit, so your email app opens with the subject only. Copy the message above and paste the copied message into the email.",
};

/**
 * The ready-to-send message for the owner's developer (s120).
 *
 * The owner sends it from their own mailbox: we never send anything, never
 * collect the developer's address, and never put anything in the message that
 * the installed page would not publish anyway — see
 * `developer-handoff-message.ts` for the guards. A snippet the builder refuses
 * gets an explanation here, not a message assembled around it.
 */
export function DeveloperHandoffMessage({
  embedScript,
  siteDomain,
  location,
}: DeveloperHandoffMessageProps) {
  const result = useMemo(
    () => buildDeveloperHandoffMessage({ embedScript, siteDomain }),
    [embedScript, siteDomain],
  );

  if (!result.ok) {
    return (
      <Alert variant="warning">
        <AlertTitle>We couldn&apos;t prepare the message</AlertTitle>
        <AlertDescription>
          <p>
            {FAILURE_EXPLANATIONS[result.reason]} Choose &ldquo;I&apos;ll do it
            myself&rdquo; to copy the snippet, and send your developer the guide
            at {DEVELOPER_GUIDE_PATH} with it.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  const { message } = result;

  return (
    <div className="space-y-4" data-testid="developer-handoff-message">
      <p className="text-sm text-muted-foreground">
        Send this from your own email. It contains this site&apos;s snippet,
        where to paste it on common platforms, a short security note and a link
        to our developer guide. ReCopyFast doesn&apos;t send anything, and you
        never need to share a password.
      </p>

      <dl className="space-y-1 text-sm">
        <dt className="text-eyebrow">Subject</dt>
        <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
          {message.subject}
        </dd>
      </dl>

      <CodeBlock
        value={formatDeveloperHandoffForCopy(message)}
        label="Message"
        copyLabel="Copy message"
        onCopied={() => trackGoal("developer_message_copied", { location })}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button asChild variant="outline" className="max-sm:w-full">
          <a
            href={message.mailtoHref}
            onClick={() =>
              trackGoal("developer_message_emailed", {
                location,
                body: message.mailtoBody,
              })
            }
          >
            <Mail aria-hidden="true" />
            Open in my email app
          </a>
        </Button>
      </div>

      {message.mailtoBody !== "full" && (
        <p className="text-sm text-muted-foreground">
          {MAILTO_FALLBACK_HELP[message.mailtoBody]}
        </p>
      )}
    </div>
  );
}
