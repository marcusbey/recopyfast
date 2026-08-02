"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { ApiKeysPanel } from "@/components/settings/ApiKeysPanel";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { User, Bell, Shield, Key, Palette, Save } from "lucide-react";

/**
 * Notification toggles. The keys match the whitelist enforced by
 * PATCH /api/auth/profile, which stores them on the user's auth metadata.
 */
const NOTIFICATION_OPTIONS = [
  {
    key: "email",
    label: "Email Notifications",
    description: "Receive updates via email",
  },
  {
    key: "contentEdits",
    label: "Content Edit Alerts",
    description: "Get notified when content is edited",
  },
  {
    key: "weeklyReports",
    label: "Weekly Reports",
    description: "Receive weekly analytics summaries",
  },
  {
    key: "marketing",
    label: "Marketing Emails",
    description: "Updates about new features and offers",
  },
] as const;

type NotificationKey = (typeof NOTIFICATION_OPTIONS)[number]["key"];
type NotificationPrefs = Record<NotificationKey, boolean>;

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  email: true,
  contentEdits: true,
  weeklyReports: false,
  marketing: false,
};

function readNotifications(metadata: unknown): NotificationPrefs {
  const stored = (metadata as { notifications?: unknown } | undefined)
    ?.notifications;
  if (typeof stored !== "object" || stored === null) {
    return DEFAULT_NOTIFICATIONS;
  }
  const source = stored as Record<string, unknown>;
  return NOTIFICATION_OPTIONS.reduce<NotificationPrefs>((acc, option) => {
    const value = source[option.key];
    return {
      ...acc,
      [option.key]:
        typeof value === "boolean" ? value : DEFAULT_NOTIFICATIONS[option.key],
    };
  }, DEFAULT_NOTIFICATIONS);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Controlled profile fields
  const [name, setName] = useState(user?.user_metadata?.name ?? "");
  const [email] = useState(user?.email ?? "");
  const [company, setCompany] = useState(user?.user_metadata?.company ?? "");
  const [role, setRole] = useState(user?.user_metadata?.role ?? "");

  const [notifications, setNotifications] = useState<NotificationPrefs>(() =>
    readNotifications(user?.user_metadata),
  );
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(
    null,
  );
  const [notificationsSaved, setNotificationsSaved] = useState(false);

  // The auth context resolves the user asynchronously, so seed the toggles
  // again once the real metadata arrives.
  useEffect(() => {
    if (user) setNotifications(readNotifications(user.user_metadata));
  }, [user]);

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, role }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const errData = data as { error?: string };
        throw new Error(errData.error ?? "Failed to save profile");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    setNotificationsError(null);
    setNotificationsSaved(false);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const errData = data as { error?: string };
        throw new Error(errData.error ?? "Failed to save preferences");
      }

      setNotificationsSaved(true);
      setTimeout(() => setNotificationsSaved(false), 3000);
    } catch (err) {
      setNotificationsError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setSavingNotifications(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and preferences
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="w-4 h-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="w-4 h-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="api">
            <Key className="w-4 h-4 mr-2" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="w-4 h-4 mr-2" />
            Appearance
          </TabsTrigger>
        </TabsList>

        {/* Profile Settings */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {saveError && (
                <p
                  role="alert"
                  className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
                >
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p className="text-sm text-tone-success-text bg-tone-success-surface border border-tone-success-border rounded-md px-3 py-2">
                  Profile saved successfully.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  disabled
                  className="bg-surface-1 text-muted-foreground cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed here. Contact support if needed.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  placeholder="Acme Inc."
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Input
                  id="role"
                  placeholder="Developer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveProfile} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notification Settings */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Choose how you want to be notified
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {notificationsError && (
                <p
                  role="alert"
                  className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
                >
                  {notificationsError}
                </p>
              )}
              {notificationsSaved && (
                <p className="text-sm text-tone-success-text bg-tone-success-surface border border-tone-success-border rounded-md px-3 py-2">
                  Preferences saved.
                </p>
              )}
              {NOTIFICATION_OPTIONS.map((option, index) => (
                <div
                  key={option.key}
                  className={`flex items-center justify-between py-3 ${
                    index < NOTIFICATION_OPTIONS.length - 1 ? "border-b" : ""
                  }`}
                >
                  <div>
                    <Label
                      htmlFor={`notification-${option.key}`}
                      className="font-medium"
                    >
                      {option.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                  <input
                    id={`notification-${option.key}`}
                    type="checkbox"
                    className="w-4 h-4"
                    checked={notifications[option.key]}
                    onChange={(e) =>
                      setNotifications((prev) => ({
                        ...prev,
                        [option.key]: e.target.checked,
                      }))
                    }
                  />
                </div>
              ))}
              <Button
                onClick={handleSaveNotifications}
                disabled={savingNotifications}
              >
                <Save className="w-4 h-4 mr-2" />
                {savingNotifications ? "Saving..." : "Save Preferences"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security">
          {/*
            There is no password card here on purpose. ReCopyFast signs in with
            magic links only — no password is ever set, and the auth callback
            excludes the `recovery` OTP type. A "change password" form would be
            a form with nothing to submit to. 2FA is likewise not implemented,
            so it is described rather than offered as a live button.
          */}
          <Card>
            <CardHeader>
              <CardTitle>Sign-in Method</CardTitle>
              <CardDescription>
                How you access your ReCopyFast account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-medium">Magic link</p>
                <p className="text-sm text-muted-foreground">
                  We email a one-time sign-in link to{" "}
                  <span className="font-medium text-foreground">
                    {email || "your address"}
                  </span>
                  . There is no password on this account, so there is nothing to
                  leak or reuse.
                </p>
              </div>
              <div className="border-t pt-4">
                <p className="font-medium">Two-factor authentication</p>
                <p className="text-sm text-muted-foreground">
                  Not available yet. Each sign-in already requires access to
                  your email inbox.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys */}
        <TabsContent value="api">
          <ApiKeysPanel />
        </TabsContent>

        {/* Appearance */}
        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize how ReCopyFast looks for you
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* No save button: the theme applies and persists on selection,
                  so a separate confirm step would only be able to no-op. */}
              <ThemePicker />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
