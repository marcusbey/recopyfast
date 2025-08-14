'use client';

import React, { useState, useEffect } from 'react';
import { Team, TeamMember, TeamInvitation, TeamActivityLog } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  Users, 
  Mail, 
  Settings, 
  Activity, 
  UserPlus, 
  MoreHorizontal,
  Crown,
  Shield,
  Eye,
  Edit3,
  Trash2
} from 'lucide-react';

interface TeamDashboardProps {
  team: Team;
  userRole: string;
  onUpdateTeam?: (team: Team) => void;
}

export function TeamDashboard({ team, userRole, onUpdateTeam }: TeamDashboardProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [activities, setActivities] = useState<TeamActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'manager'>('editor');
  const [inviteLoading, setInviteLoading] = useState(false);

  const canManageTeam = userRole === 'manager' || userRole === 'owner';
  const canInvite = canManageTeam;

  useEffect(() => {
    loadTeamData();
  }, [team.id]);

  const loadTeamData = async () => {
    try {
      setLoading(true);
      
      // Load team members
      const membersResponse = await fetch(`/api/teams/${team.id}/members`);
      if (membersResponse.ok) {
        const { members } = await membersResponse.json();
        setMembers(members);
      }

      // Load invitations if user can manage
      if (canManageTeam) {
        const invitationsResponse = await fetch(`/api/teams/${team.id}/invitations`);
        if (invitationsResponse.ok) {
          const { invitations } = await invitationsResponse.json();
          setInvitations(invitations);
        }
      }

      // Load recent activity
      const activityResponse = await fetch(`/api/teams/${team.id}/activity?limit=20`);
      if (activityResponse.ok) {
        const { activities } = await activityResponse.json();
        setActivities(activities);
      }
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) return;

    try {
      setInviteLoading(true);
      const response = await fetch(`/api/teams/${team.id}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          teamId: team.id,
        }),
      });

      if (response.ok) {
        setInviteEmail('');
        setInviteDialogOpen(false);
        loadTeamData(); // Refresh data
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to send invitation');
      }
    } catch (error) {
      console.error('Error inviting member:', error);
      alert('Failed to send invitation');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleUpdateMemberRole = async (memberId: string, newRole: string) => {
    try {
      const response = await fetch(`/api/teams/${team.id}/members`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId,
          role: newRole,
        }),
      });

      if (response.ok) {
        loadTeamData(); // Refresh data
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update member role');
      }
    } catch (error) {
      console.error('Error updating member role:', error);
      alert('Failed to update member role');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this member from the team?')) {
      return;
    }

    try {
      const response = await fetch(`/api/teams/${team.id}/members?memberId=${memberId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadTeamData(); // Refresh data
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to remove member');
      }
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member');
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'manager':
        return <Shield className="h-4 w-4 text-blue-500" />;
      case 'editor':
        return <Edit3 className="h-4 w-4 text-green-500" />;
      case 'viewer':
        return <Eye className="h-4 w-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-yellow-100 text-yellow-800';
      case 'manager':
        return 'bg-blue-100 text-blue-800';
      case 'editor':
        return 'bg-green-100 text-green-800';
      case 'viewer':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatActivityAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading team data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{team.name}</h1>
          {team.description && (
            <p className="text-gray-600 mt-1">{team.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2">
            <Badge variant="outline">
              {members.length} / {team.max_members} members
            </Badge>
            <Badge variant="outline" className="capitalize">
              {team.billing_plan} plan
            </Badge>
          </div>
        </div>
        
        {canInvite && (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="member@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="viewer">Viewer - Can view content</option>
                    <option value="editor">Editor - Can edit content</option>
                    <option value="manager">Manager - Can manage team</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setInviteDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleInviteMember}
                    disabled={inviteLoading || !inviteEmail.trim()}
                  >
                    {inviteLoading ? 'Sending...' : 'Send Invitation'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Team Tabs */}
      <Tabs defaultValue="members" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="members" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          {canManageTeam && (
            <TabsTrigger value="invitations" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Invitations
            </TabsTrigger>
          )}
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
          </TabsTrigger>
          {canManageTeam && (
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          )}
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Team Members ({members.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                        {member.user?.raw_user_meta_data?.avatar_url ? (
                          <img
                            src={member.user.raw_user_meta_data.avatar_url}
                            alt="Avatar"
                            className="w-10 h-10 rounded-full"
                          />
                        ) : (
                          <span className="text-gray-600 font-medium">
                            {member.user?.email?.[0]?.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {member.user?.raw_user_meta_data?.name || member.user?.email}
                          </p>
                          {getRoleIcon(member.role)}
                        </div>
                        <p className="text-sm text-gray-600">{member.user?.email}</p>
                        <p className="text-xs text-gray-500">
                          Joined {new Date(member.joined_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge className={getRoleBadgeColor(member.role)}>
                        {member.role}
                      </Badge>
                      
                      {canManageTeam && member.role !== 'owner' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleUpdateMemberRole(member.id, 'viewer')}
                              disabled={member.role === 'viewer'}
                            >
                              Make Viewer
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateMemberRole(member.id, 'editor')}
                              disabled={member.role === 'editor'}
                            >
                              Make Editor
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateMemberRole(member.id, 'manager')}
                              disabled={member.role === 'manager'}
                            >
                              Make Manager
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove from team
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Invitations Tab */}
        {canManageTeam && (
          <TabsContent value="invitations">
            <Card>
              <CardHeader>
                <CardTitle>Pending Invitations ({invitations.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {invitations.length === 0 ? (
                  <p className="text-gray-600 text-center py-8">
                    No pending invitations
                  </p>
                ) : (
                  <div className="space-y-4">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{invitation.email}</p>
                          <p className="text-sm text-gray-600">
                            Invited as {invitation.role} • 
                            Expires {new Date(invitation.expires_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge className={getRoleBadgeColor(invitation.role)}>
                          {invitation.role}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-gray-600 text-center py-8">
                  No recent activity
                </p>
              ) : (
                <div className="space-y-4">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-4 border rounded-lg"
                    >
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <Activity className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">
                          {formatActivityAction(activity.action)}
                        </p>
                        <p className="text-sm text-gray-600">
                          {activity.user?.email || 'System'} • 
                          {new Date(activity.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        {canManageTeam && (
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Team Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <Label htmlFor="team-name">Team Name</Label>
                    <Input
                      id="team-name"
                      value={team.name}
                      onChange={(e) => {
                        if (onUpdateTeam) {
                          onUpdateTeam({ ...team, name: e.target.value });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="team-description">Description</Label>
                    <Input
                      id="team-description"
                      value={team.description || ''}
                      onChange={(e) => {
                        if (onUpdateTeam) {
                          onUpdateTeam({ ...team, description: e.target.value });
                        }
                      }}
                      placeholder="Optional team description"
                    />
                  </div>
                  <div>
                    <Label>Billing Plan</Label>
                    <p className="text-sm text-gray-600 capitalize">
                      {team.billing_plan} plan - {team.max_members} members max
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}