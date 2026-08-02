"use client";

import { useState, useEffect, useCallback, useRef, useId } from "react";
import Link from "next/link";
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
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Plus,
  Mail,
  Crown,
  Shield,
  UserX,
  Lock,
  Loader2,
} from "lucide-react";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  status?: string;
  user?: {
    email?: string;
    raw_user_meta_data?: { name?: string };
  };
}

/** Roles the invitations endpoint accepts. */
const INVITE_ROLES = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "manager", label: "Manager" },
] as const;

type InviteRole = (typeof INVITE_ROLES)[number]["value"];

async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Non-JSON body — fall back to a status-qualified message.
  }
  return `${fallback} (${response.status})`;
}

export default function TeamsPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const inviteEmailId = useId();
  const inviteRoleId = useId();

  const fetchMembers = useCallback(async (id: string) => {
    setLoadingMembers(true);
    try {
      const membersRes = await fetch(`/api/teams/${id}/members`);
      if (!membersRes.ok) {
        throw new Error(await readError(membersRes, "Failed to fetch members"));
      }
      const membersData = await membersRes.json();
      setMembers(membersData.members ?? []);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Fetch the user's first team, then its members
  useEffect(() => {
    const fetchTeamAndMembers = async () => {
      setLoadingTeams(true);
      setFetchError(null);
      try {
        const teamsRes = await fetch("/api/teams");
        if (!teamsRes.ok) {
          throw new Error(await readError(teamsRes, "Failed to fetch teams"));
        }
        const teamsData = await teamsRes.json();
        const teams: Array<{ id: string }> = teamsData.teams ?? [];

        if (teams.length === 0) {
          setLoadingTeams(false);
          return;
        }

        const firstTeamId = teams[0].id;
        setTeamId(firstTeamId);
        setLoadingTeams(false);

        await fetchMembers(firstTeamId);
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : "Failed to load team data",
        );
      } finally {
        setLoadingTeams(false);
        setLoadingMembers(false);
      }
    };

    fetchTeamAndMembers();
  }, [fetchMembers]);

  const handleInvite = async () => {
    if (!teamId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      const response = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          teamId,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Failed to send invitation"));
      }

      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      // A pending invite changes the counts shown above the form.
      await fetchMembers(teamId);
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Failed to send invitation",
      );
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!teamId) return;
    const name = member.user?.email ?? "this member";
    if (!window.confirm(`Remove ${name} from the team?`)) return;

    setRemovingId(member.id);
    setFetchError(null);
    try {
      const response = await fetch(
        `/api/teams/${teamId}/members?memberId=${member.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to remove member"));
      }
      await fetchMembers(teamId);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to remove member",
      );
    } finally {
      setRemovingId(null);
    }
  };

  const getMemberName = (member: TeamMember): string => {
    return (
      member.user?.raw_user_meta_data?.name ?? member.user?.email ?? "Unknown"
    );
  };

  const getMemberEmail = (member: TeamMember): string => {
    return member.user?.email ?? "";
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return (
          <Badge variant="tone-accent">
            <Crown className="w-3 h-3 mr-1" />
            Owner
          </Badge>
        );
      case "admin":
      case "manager":
        return (
          <Badge className="bg-tone-info-surface text-tone-info-text border-tone-info-border">
            <Shield className="w-3 h-3 mr-1" />
            Admin
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted text-foreground border-border">
            <Users className="w-3 h-3 mr-1" />
            Member
          </Badge>
        );
    }
  };

  const activeCount = members.filter(
    (m) => (m.status ?? "active") === "active",
  ).length;

  const pendingCount = members.filter((m) => m.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Teams</h1>
          <p className="text-muted-foreground mt-1">
            Collaborate with your team members
          </p>
        </div>
        {/* Shortcut to the invite form further down the page rather than a
            second, competing invite control. */}
        <Button
          className="bg-primary"
          disabled={!teamId}
          onClick={() => inviteEmailRef.current?.focus()}
        >
          <Plus className="w-4 h-4 mr-2" />
          Invite Member
        </Button>
      </div>

      {/* Pro Feature Notice */}
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-1">
                Pro Feature
              </h3>
              <p className="text-muted-foreground mb-4">
                Team collaboration is available on the Pro plan. Upgrade to
                invite team members and manage permissions.
              </p>
              <Button asChild className="bg-primary">
                <Link href="/dashboard/billing">Upgrade to Pro</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Team Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Members</p>
                <p className="text-2xl font-bold text-foreground">
                  {members.length}
                </p>
              </div>
              <Users className="w-8 h-8 text-tone-info-text" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Members</p>
                <p className="text-2xl font-bold text-foreground">
                  {activeCount}
                </p>
              </div>
              <Shield className="w-8 h-8 text-tone-success-text" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Invites</p>
                <p className="text-2xl font-bold text-foreground">
                  {pendingCount}
                </p>
              </div>
              <Mail className="w-8 h-8 text-tone-warning-text" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invite New Member */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
          <CardDescription>
            Send an invitation to collaborate on your sites
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteError && (
            <p
              role="alert"
              className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
            >
              {inviteError}
            </p>
          )}
          {inviteSuccess && (
            <p className="text-sm text-tone-success-text bg-tone-success-surface border border-tone-success-border rounded-md px-3 py-2">
              {inviteSuccess}
            </p>
          )}
          {/* A real form so Enter submits, which is what people expect from a
              single-field invite box. */}
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              handleInvite();
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor={inviteEmailId}>Email address</Label>
              <Input
                id={inviteEmailId}
                ref={inviteEmailRef}
                placeholder="email@example.com"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={!teamId || inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={inviteRoleId}>Role</Label>
              <select
                id={inviteRoleId}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                disabled={!teamId || inviting}
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-transparent sm:w-40"
              >
                {INVITE_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              disabled={!teamId || inviting || !inviteEmail.trim()}
            >
              <Mail className="w-4 h-4 mr-2" />
              {inviting ? "Sending..." : "Send Invite"}
            </Button>
          </form>
          {!teamId && !loadingTeams && (
            <p className="text-sm text-muted-foreground">
              You need to belong to a team before you can invite anyone.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Team Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            Manage your team members and their roles
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTeams || loadingMembers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-tone-info-text" />
            </div>
          ) : fetchError ? (
            <p className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2">
              {fetchError}
            </p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {teamId
                ? "No team members found."
                : "You are not a member of any team yet."}
            </p>
          ) : (
            <div className="space-y-4">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-surface-1 rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-semibold">
                      {getMemberName(member).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {getMemberName(member)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {getMemberEmail(member)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getRoleBadge(member.role)}
                    {member.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${getMemberName(member)} from the team`}
                        disabled={removingId === member.id}
                        onClick={() => handleRemoveMember(member)}
                      >
                        {removingId === member.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserX className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roles & Permissions */}
      <Card>
        <CardHeader>
          <CardTitle>Roles &amp; Permissions</CardTitle>
          <CardDescription>
            Understanding team member permissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-tone-accent-border">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-5 h-5 text-tone-accent-text" />
                <h4 className="font-semibold text-foreground">Owner</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Full access to all features, billing, and team management
              </p>
            </div>

            <div className="p-4 border border-tone-info-border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-tone-info-text" />
                <h4 className="font-semibold text-foreground">Admin</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Can manage sites, content, and invite team members
              </p>
            </div>

            <div className="p-4 border border-border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                <h4 className="font-semibold text-foreground">Member</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Can view analytics and edit content on assigned sites
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
