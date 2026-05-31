"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { User, Bell, Shield, Key, Palette, Save } from "lucide-react";

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">
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
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
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
                  className="bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500">
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
              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <p className="font-medium">Email Notifications</p>
                  <p className="text-sm text-gray-600">
                    Receive updates via email
                  </p>
                </div>
                <input type="checkbox" defaultChecked className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <p className="font-medium">Content Edit Alerts</p>
                  <p className="text-sm text-gray-600">
                    Get notified when content is edited
                  </p>
                </div>
                <input type="checkbox" defaultChecked className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <p className="font-medium">Weekly Reports</p>
                  <p className="text-sm text-gray-600">
                    Receive weekly analytics summaries
                  </p>
                </div>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Marketing Emails</p>
                  <p className="text-sm text-gray-600">
                    Updates about new features and offers
                  </p>
                </div>
                <input type="checkbox" className="w-4 h-4" />
              </div>
              <Button disabled>
                <Save className="w-4 h-4 mr-2" />
                Save Preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>
                  Update your password to keep your account secure
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input id="current-password" type="password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input id="new-password" type="password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input id="confirm-password" type="password" />
                </div>
                <Button>Update Password</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>
                  Add an extra layer of security to your account
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">2FA Status</p>
                    <p className="text-sm text-gray-600">Currently disabled</p>
                  </div>
                  <Button variant="outline">Enable 2FA</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* API Keys */}
        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Manage your API keys for programmatic access
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">Production Key</p>
                  <Badge className="bg-green-100 text-green-700">Active</Badge>
                </div>
                <code className="text-sm text-gray-600 break-all">
                  rf_prod_xxxxxxxxxxxxxxxxxxxx
                </code>
              </div>
              <Button variant="outline">
                <Key className="w-4 h-4 mr-2" />
                Generate New Key
              </Button>
            </CardContent>
          </Card>
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
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Theme</Label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border-2 border-blue-600 rounded-lg p-4 cursor-pointer">
                    <div className="w-full h-20 bg-white rounded mb-2"></div>
                    <p className="text-sm font-medium text-center">Light</p>
                  </div>
                  <div className="border-2 border-gray-200 rounded-lg p-4 cursor-pointer">
                    <div className="w-full h-20 bg-gray-900 rounded mb-2"></div>
                    <p className="text-sm font-medium text-center">Dark</p>
                  </div>
                  <div className="border-2 border-gray-200 rounded-lg p-4 cursor-pointer">
                    <div className="w-full h-20 bg-gradient-to-br from-gray-900 to-gray-600 rounded mb-2"></div>
                    <p className="text-sm font-medium text-center">System</p>
                  </div>
                </div>
              </div>
              <Button disabled>
                <Save className="w-4 h-4 mr-2" />
                Save Appearance
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
