"use client";

import React, { useState, useEffect } from "react";
import { Team } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Users,
  ChevronDown,
  Crown,
  Shield,
  Edit3,
  Eye,
} from "lucide-react";

interface TeamSelectorProps {
  selectedTeam?: Team & { role?: string };
  onTeamSelect: (team: Team) => void;
  onCreateTeam?: (team: Team) => void;
}

export function TeamSelector({
  selectedTeam,
  onTeamSelect,
  onCreateTeam,
}: TeamSelectorProps) {
  const [teams, setTeams] = useState<(Team & { role?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/teams");
      if (response.ok) {
        const { teams } = await response.json();

        // Add user role from team_members data
        const teamsWithRoles = (
          teams as (Team & { team_members?: { role: string }[] })[]
        ).map((team) => ({
          ...team,
          role: team.team_members?.[0]?.role || "member",
        }));

        setTeams(teamsWithRoles);

        // Auto-select first team if none selected
        if (!selectedTeam && teamsWithRoles.length > 0) {
          onTeamSelect(teamsWithRoles[0]);
        }
      }
    } catch (error) {
      console.error("Error loading teams:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;

    try {
      setCreateLoading(true);
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newTeamName.trim(),
          description: newTeamDescription.trim() || undefined,
        }),
      });

      if (response.ok) {
        const { team } = await response.json();
        const teamWithRole = { ...team, role: "owner" };

        setTeams((prev) => [...prev, teamWithRole]);
        setNewTeamName("");
        setNewTeamDescription("");
        setCreateDialogOpen(false);

        if (onCreateTeam) {
          onCreateTeam(teamWithRole);
        }

        onTeamSelect(teamWithRole);
      } else {
        const error = await response.json();
        alert(error.error || "Failed to create team");
      }
    } catch (error) {
      console.error("Error creating team:", error);
      alert("Failed to create team");
    } finally {
      setCreateLoading(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="h-3 w-3 text-tone-warning-text" />;
      case "manager":
        return <Shield className="h-3 w-3 text-tone-info-text" />;
      case "editor":
        return <Edit3 className="h-3 w-3 text-tone-success-text" />;
      case "viewer":
        return <Eye className="h-3 w-3 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-tone-warning-surface text-tone-warning-text";
      case "manager":
        return "bg-tone-info-surface text-tone-info-text";
      case "editor":
        return "bg-tone-success-surface text-tone-success-text";
      case "viewer":
        return "bg-surface-2 text-foreground";
      default:
        return "bg-surface-2 text-foreground";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="animate-spin h-4 w-4 border-b-2 border-primary rounded-full"></div>
        <span className="text-sm text-muted-foreground">Loading teams...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Team Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="justify-between min-w-[200px]">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {selectedTeam ? (
                <div className="flex items-center gap-2">
                  <span className="truncate">{selectedTeam.name}</span>
                  {selectedTeam.role && getRoleIcon(selectedTeam.role)}
                </div>
              ) : (
                <span>Select Team</span>
              )}
            </div>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[300px]">
          {teams.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">No teams yet</p>
              <p className="text-xs text-muted-foreground">
                Create your first team to get started
              </p>
            </div>
          ) : (
            teams.map((team) => (
              <DropdownMenuItem
                key={team.id}
                onClick={() => onTeamSelect(team)}
                className="flex items-center justify-between p-3"
              >
                <div className="flex items-center gap-2 flex-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{team.name}</span>
                      {team.role && getRoleIcon(team.role)}
                    </div>
                    {team.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {team.description}
                      </p>
                    )}
                  </div>
                </div>
                {team.role && (
                  <Badge className={`${getRoleBadgeColor(team.role)} text-xs`}>
                    {team.role}
                  </Badge>
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Team Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="flex items-center gap-1">
            <Plus className="h-4 w-4" />
            Create Team
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="team-name">Team Name *</Label>
              <Input
                id="team-name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Enter team name"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="team-description">Description (Optional)</Label>
              <Input
                id="team-description"
                value={newTeamDescription}
                onChange={(e) => setNewTeamDescription(e.target.value)}
                placeholder="Brief description of your team"
                maxLength={255}
              />
            </div>
            <div className="bg-tone-info-surface p-3 rounded-lg">
              <p className="text-sm text-tone-info-text">
                <strong>Free Plan:</strong> Your team can have up to 5 members.
                You can upgrade later to add more members.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTeam}
                disabled={createLoading || !newTeamName.trim()}
              >
                {createLoading ? "Creating..." : "Create Team"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Individual Team Card Component for grid layout
interface TeamCardProps {
  team: Team & { role?: string };
  isSelected?: boolean;
  onClick: () => void;
}

export function TeamCard({ team, isSelected, onClick }: TeamCardProps) {
  const getRoleIcon = (role: string) => {
    switch (role) {
      case "owner":
        return <Crown className="h-4 w-4 text-tone-warning-text" />;
      case "manager":
        return <Shield className="h-4 w-4 text-tone-info-text" />;
      case "editor":
        return <Edit3 className="h-4 w-4 text-tone-success-text" />;
      case "viewer":
        return <Eye className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-tone-warning-surface text-tone-warning-text";
      case "manager":
        return "bg-tone-info-surface text-tone-info-text";
      case "editor":
        return "bg-tone-success-surface text-tone-success-text";
      case "viewer":
        return "bg-surface-2 text-foreground";
      default:
        return "bg-surface-2 text-foreground";
    }
  };

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? "ring-2 ring-ring bg-tone-info-surface" : ""
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {team.name}
            {team.role && getRoleIcon(team.role)}
          </CardTitle>
          {team.role && (
            <Badge className={getRoleBadgeColor(team.role)}>{team.role}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {team.description && (
          <p className="text-muted-foreground text-sm mb-3">
            {team.description}
          </p>
        )}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{team.max_members} members max</span>
          </div>
          <Badge variant="outline" className="capitalize">
            {team.billing_plan}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
