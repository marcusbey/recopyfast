"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function TeamsPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch the user's first team, then its members
  useEffect(() => {
    const fetchTeamAndMembers = async () => {
      setLoadingTeams(true);
      setFetchError(null);
      try {
        const teamsRes = await fetch("/api/teams");
        if (!teamsRes.ok) {
          throw new Error("Failed to fetch teams");
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
        setLoadingMembers(true);

        const membersRes = await fetch(`/api/teams/${firstTeamId}/members`);
        if (!membersRes.ok) {
          throw new Error("Failed to fetch team members");
        }
        const membersData = await membersRes.json();
        setMembers(membersData.members ?? []);
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
  }, []);

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
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
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
        <Button
          className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
          disabled
        >
          <Plus className="w-4 h-4 mr-2" />
          Invite Member
        </Button>
      </div>

      {/* Pro Feature Notice */}
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex items-center justify-center flex-shrink-0">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-1">
                Pro Feature
              </h3>
              <p className="text-muted-foreground mb-4">
                Team collaboration is available on Pro and Enterprise plans.
                Upgrade to invite team members and manage permissions.
              </p>
              <Button className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70">
                Upgrade to Pro
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
              <Users className="w-8 h-8 text-blue-600" />
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
              <Shield className="w-8 h-8 text-green-600" />
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
              <Mail className="w-8 h-8 text-yellow-600" />
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
        <CardContent>
          <div className="flex gap-4">
            <Input
              placeholder="email@example.com"
              type="email"
              className="flex-1"
              disabled
            />
            <Button disabled className="cursor-not-allowed opacity-50">
              <Mail className="w-4 h-4 mr-2" />
              Send Invite
            </Button>
          </div>
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
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : fetchError ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
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
                    <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/70 rounded-full flex items-center justify-center text-white font-semibold">
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
                      <Button variant="ghost" size="sm" disabled>
                        <UserX className="w-4 h-4" />
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
                <Crown className="w-5 h-5 text-purple-600" />
                <h4 className="font-semibold text-foreground">Owner</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Full access to all features, billing, and team management
              </p>
            </div>

            <div className="p-4 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-blue-600" />
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
