"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Edit,
  Eye,
  Loader2,
  Shield,
  Upload,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EditorPermission } from "@/lib/auth/editor-access";

interface InviteEditorFormProps {
  /**
   * Performs the enrolment. Resolves true when the editor was added, which is
   * the signal for this form to clear itself; false leaves the typed address in
   * place so the owner can correct it rather than retype it.
   */
  onInvite: (
    email: string,
    permissions: EditorPermission[],
  ) => Promise<boolean>;
}

const PERMISSION_CHOICES: ReadonlyArray<{
  key: EditorPermission;
  icon: LucideIcon;
  label: string;
}> = [
  { key: "view", icon: Eye, label: "View" },
  { key: "edit", icon: Edit, label: "Edit" },
  { key: "publish", icon: Upload, label: "Publish" },
  { key: "admin", icon: Shield, label: "Admin" },
];

const DEFAULT_PERMISSIONS: readonly EditorPermission[] = ["view", "edit"];

export function InviteEditorForm({ onInvite }: InviteEditorFormProps) {
  const emailFieldId = useId();
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<EditorPermission[]>([
    ...DEFAULT_PERMISSIONS,
  ]);
  const [submitting, setSubmitting] = useState(false);

  const trimmedEmail = email.trim();
  const canSubmit =
    !submitting && trimmedEmail !== "" && permissions.length > 0;

  const togglePermission = (permission: EditorPermission) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const added = await onInvite(trimmedEmail, permissions);
      if (added) {
        setEmail("");
        setPermissions([...DEFAULT_PERMISSIONS]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border-t pt-4">
      <div className="space-y-2">
        <Label htmlFor={emailFieldId}>Editor email</Label>
        <Input
          id={emailFieldId}
          type="email"
          autoComplete="off"
          placeholder="marketing@clientcompany.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Permissions</Label>
        <div className="grid grid-cols-2 gap-2">
          {PERMISSION_CHOICES.map(({ key, icon: Icon, label }) => {
            const selected = permissions.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => togglePermission(key)}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2 transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "border-primary bg-tone-info-surface text-tone-info-text"
                    : "border-border text-muted-foreground hover:border-input",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm font-medium">{label}</span>
                {selected && (
                  <CheckCircle2
                    className="ml-auto h-4 w-4 text-tone-info-text"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
        {/* The server widens a permission to everything it implies — publish
            brings edit and view with it — so the list that comes back may be
            longer than the one selected here. */}
        <p className="text-xs text-muted-foreground">
          Higher permissions include the ones below them.
        </p>
      </div>

      <Button type="submit" disabled={!canSubmit} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Adding editor...
          </>
        ) : (
          <>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add editor
          </>
        )}
      </Button>
    </form>
  );
}
