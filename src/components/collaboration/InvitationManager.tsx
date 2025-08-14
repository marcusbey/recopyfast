'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeamInvitation } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Mail, 
  Check, 
  X, 
  Clock, 
  Users,
  Crown,
  Shield,
  Edit3,
  Eye,
  AlertCircle,
  CheckCircle
} from 'lucide-react';

export function InvitationManager() {
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingInvitation, setProcessingInvitation] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const inviteToken = searchParams?.get('token');

  useEffect(() => {
    loadInvitations();
    
    // Auto-process invitation if token is provided
    if (inviteToken) {
      handleAcceptInvitation(inviteToken, true);
    }
  }, [inviteToken]);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/notifications?unread_only=true');
      if (response.ok) {
        const { notifications } = await response.json();
        
        // Filter invitation notifications and extract invitation data
        const invitationNotifications = notifications.filter(
          (n: any) => n.type === 'invitation' && n.data.invitation_id
        );
        
        // For now, we'll create invitation objects from notification data
        // In a real implementation, you might want to fetch actual invitation details
        const inviteData = invitationNotifications.map((n: any) => ({
          id: n.data.invitation_id,
          team_id: n.data.team_id,
          email: n.data.email,
          role: n.data.role,
          token: '', // We don't have access to token here
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: n.created_at,
          team: {
            name: n.data.team_name || 'Unknown Team',
          },
          inviter: {
            email: n.data.inviter_email || 'Unknown',
          },
        }));
        
        setInvitations(inviteData);
      }
    } catch (error) {
      console.error('Error loading invitations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async (token: string, autoAccept = false) => {
    try {
      setProcessingInvitation(token);
      
      const response = await fetch('/api/teams/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        const result = await response.json();
        
        if (!autoAccept) {
          alert(`Successfully joined team: ${result.team.name}`);
        }
        
        // Reload invitations
        loadInvitations();
        
        // Redirect to team dashboard or reload page
        if (autoAccept) {
          window.location.href = '/dashboard?tab=teams';
        }
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to accept invitation');
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      alert('Failed to accept invitation');
    } finally {
      setProcessingInvitation(null);
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

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diff = expiry.getTime() - now.getTime();
    
    if (diff <= 0) return 'Expired';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} remaining`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} remaining`;
    } else {
      return 'Expires soon';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invitations...</p>
        </div>
      </div>
    );
  }

  // Auto-accept flow
  if (inviteToken && processingInvitation) {
    return (
      <div className="max-w-md mx-auto mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Accepting Invitation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Processing your team invitation...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Mail className="h-6 w-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-900">Team Invitations</h2>
        {invitations.length > 0 && (
          <Badge variant="secondary">{invitations.length}</Badge>
        )}
      </div>

      {/* Auto-accept success message */}
      {inviteToken && !processingInvitation && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Invitation processed successfully! You can now access your team dashboard.
          </AlertDescription>
        </Alert>
      )}

      {/* Invitations List */}
      {invitations.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No pending invitations
            </h3>
            <p className="text-gray-600">
              You don't have any pending team invitations at the moment.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {invitations.map((invitation) => (
            <Card key={invitation.id} className="relative">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    {invitation.team?.name || 'Team Invitation'}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className={getRoleBadgeColor(invitation.role)}>
                      <span className="flex items-center gap-1">
                        {getRoleIcon(invitation.role)}
                        {invitation.role}
                      </span>
                    </Badge>
                    {isExpired(invitation.expires_at) && (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Expired
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-gray-600">
                      <strong>{invitation.inviter?.email || 'Someone'}</strong> invited you to join{' '}
                      <strong>{invitation.team?.name}</strong> as a <strong>{invitation.role}</strong>.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {formatTimeRemaining(invitation.expires_at)}
                    </div>
                    <div>
                      Invited {new Date(invitation.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {!isExpired(invitation.expires_at) && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleAcceptInvitation(invitation.token)}
                        disabled={processingInvitation === invitation.token}
                        className="flex items-center gap-2"
                      >
                        <Check className="h-4 w-4" />
                        {processingInvitation === invitation.token ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={processingInvitation === invitation.token}
                        className="flex items-center gap-2"
                      >
                        <X className="h-4 w-4" />
                        Decline
                      </Button>
                    </div>
                  )}

                  {isExpired(invitation.expires_at) && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        This invitation has expired. Please contact the team owner for a new invitation.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Invitation acceptance page component for standalone use
export function InvitationAcceptancePage() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token');

  if (!token) {
    return (
      <div className="max-w-md mx-auto mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Invalid Invitation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This invitation link is invalid or has expired. Please contact the team owner for a new invitation.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <InvitationManager />;
}