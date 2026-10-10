"use client";

import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Edit, Eye, Shield, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EditorPermission } from "@/lib/auth/editor-access";

export interface InviteEditorFormState {
  /** The email field and the permission toggles. */
  fields: ReactNode;
  canSubmit: boolean;
  isSubmitting: boolean;
}

interface InviteEditorFormProps {
  autoFocus?: boolean;
  initialPermissions?: readonly EditorPermission[];
  /**
   * Performs the enrolment. Resolves true when the editor was added, which is
   * the signal for this form to clear itself; false leaves the typed address in
   * place so the owner can correct it rather than retype it.
   */
  onInvite: (
    email: string,
    permissions: EditorPermission[],
  ) => Promise<boolean>;
  /**
   * Lays the form out. s66c1 moved it into `AddEditorDialog`, where the fields
   * sit in the dialog's body and the submit button in its footer: one <form>
   * must span both, and be the dialog's flex region itself (design system,
   * Dialogs and sheets), so the caller places the pieces.
   */
  children: (form: InviteEditorFormState) => ReactNode;
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

export function InviteEditorForm({
  onInvite,
  autoFocus = false,
  initialPermissions = DEFAULT_PERMISSIONS,
  children,
}: InviteEditorFormProps) {
  const emailFieldId = useId();
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<EditorPermission[]>([
    ...initialPermissions,
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
        setPermissions([...initialPermissions]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fields = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={emailFieldId}>Editor email</Label>
        <Input
          id={emailFieldId}
          type="email"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="marketing@clientcompany.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Permissions</Label>
        <div className="grid grid-cols-2 gap-2">
          {PERMISSION_CHOICES.map(({ key, icon: Icon, label }) => {
            const selected = permissions.includes(key);
            return (
              // s66a's permission toggle (design system, Controls): 40 tall,
              // 2px radius, 1px `border-input`; selected is the accent border
              // and a tick, never a thicker border or a pill.
              <button
                key={key}
                type="button"
                onClick={() => togglePermission(key)}
                aria-pressed={selected}
                className={cn(
                  "flex h-10 min-w-0 items-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "border-primary bg-tone-accent-surface text-tone-accent-text"
                    : "border-input text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
                {selected && (
                  <Check
                    className="ml-auto h-4 w-4 shrink-0"
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
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      {children({ fields, canSubmit, isSubmitting: submitting })}
    </form>
  );
}
