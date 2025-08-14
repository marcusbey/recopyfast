'use client';

import React, { useState, useEffect } from 'react';
import { PresenceData } from '@/types';
import { collaborationRealtime } from '@/lib/collaboration/realtime';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Users, 
  Eye,
  Edit3,
  Crown,
  Shield,
  Circle
} from 'lucide-react';

interface PresenceIndicatorProps {
  siteId: string;
  currentUserId: string;
  elementId?: string; // Show presence for specific element
  showDetails?: boolean;
  className?: string;
}

export function PresenceIndicator({ 
  siteId, 
  currentUserId, 
  elementId, 
  showDetails = false,
  className 
}: PresenceIndicatorProps) {
  const [presenceList, setPresenceList] = useState<PresenceData[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to collaboration if not connected
    if (!collaborationRealtime.isConnected) {
      collaborationRealtime.connect(siteId);
    }

    const handleConnect = () => {
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      setPresenceList([]);
    };

    const handlePresenceUpdate = (presence: PresenceData) => {
      if (presence.userId === currentUserId) return;
      
      setPresenceList(prev => {
        const filtered = prev.filter(p => p.userId !== presence.userId);
        return [...filtered, presence];
      });
    };

    const handleUserLeft = (userId: string) => {
      setPresenceList(prev => prev.filter(p => p.userId !== userId));
    };

    const handlePresenceList = (users: PresenceData[]) => {
      const filteredUsers = users.filter(p => p.userId !== currentUserId);
      setPresenceList(filteredUsers);
    };

    // Set up event listeners
    collaborationRealtime.on('connect', handleConnect);
    collaborationRealtime.on('disconnect', handleDisconnect);
    collaborationRealtime.on('presence-updated', handlePresenceUpdate);
    collaborationRealtime.on('user-left', handleUserLeft);
    collaborationRealtime.on('presence-list', handlePresenceList);

    return () => {
      collaborationRealtime.off('connect', handleConnect);
      collaborationRealtime.off('disconnect', handleDisconnect);
      collaborationRealtime.off('presence-updated', handlePresenceUpdate);
      collaborationRealtime.off('user-left', handleUserLeft);
      collaborationRealtime.off('presence-list', handlePresenceList);
    };
  }, [siteId, currentUserId]);

  // Filter presence by element if specified
  const relevantPresence = elementId 
    ? presenceList.filter(p => p.elementId === elementId)
    : presenceList;

  // Get users currently editing this element
  const editingUsers = relevantPresence.filter(p => 
    p.elementId === elementId && 
    p.cursorPosition !== undefined
  );

  // Get users viewing but not editing
  const viewingUsers = relevantPresence.filter(p => 
    (!elementId || p.elementId !== elementId) ||
    p.cursorPosition === undefined
  );

  const getUserAvatar = (presence: PresenceData) => {
    if (presence.userAvatar) {
      return (
        <img
          src={presence.userAvatar}
          alt={presence.userName || presence.userEmail}
          className="w-6 h-6 rounded-full border-2 border-white"
        />
      );
    }

    const initials = (presence.userName || presence.userEmail)
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    return (
      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-medium flex items-center justify-center border-2 border-white">
        {initials}
      </div>
    );
  };

  const getActivityStatus = (presence: PresenceData) => {
    const lastActivity = new Date(presence.lastActivity);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'active';
    if (diffInMinutes < 5) return 'recent';
    return 'idle';
  };

  const getActivityColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'recent':
        return 'bg-yellow-500';
      case 'idle':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  };

  const formatLastSeen = (lastActivity: string) => {
    const date = new Date(lastActivity);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Active now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    return date.toLocaleDateString();
  };

  if (!isConnected) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 ${className}`}>
        <Circle className="h-4 w-4 fill-gray-300" />
        <span className="text-sm">Offline</span>
      </div>
    );
  }

  if (relevantPresence.length === 0) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 ${className}`}>
        <Circle className="h-4 w-4 fill-green-500" />
        <span className="text-sm">Online (alone)</span>
      </div>
    );
  }

  if (!showDetails) {
    // Compact view - just show avatars and count
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="flex -space-x-2">
          {relevantPresence.slice(0, 3).map((presence) => (
            <div key={presence.userId} className="relative">
              {getUserAvatar(presence)}
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-white ${getActivityColor(
                  getActivityStatus(presence)
                )}`}
              />
            </div>
          ))}
          {relevantPresence.length > 3 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 border-2 border-white text-xs font-medium flex items-center justify-center">
              +{relevantPresence.length - 3}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <Users className="h-4 w-4" />
          <span>{relevantPresence.length + 1} online</span>
        </div>
      </div>
    );
  }

  // Detailed view
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-600" />
            <h3 className="font-medium">Who's Online</h3>
            <Badge variant="secondary">{relevantPresence.length + 1}</Badge>
          </div>

          {/* Currently editing users */}
          {editingUsers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                <Edit3 className="h-4 w-4" />
                Currently Editing
              </h4>
              <div className="space-y-2">
                {editingUsers.map((presence) => (
                  <div key={presence.userId} className="flex items-center gap-3">
                    <div className="relative">
                      {getUserAvatar(presence)}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border border-white animate-pulse" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {presence.userName || presence.userEmail}
                      </p>
                      <p className="text-xs text-gray-500">
                        Editing • {formatLastSeen(presence.lastActivity)}
                      </p>
                    </div>
                    <Badge variant="outline" size="sm">
                      <Edit3 className="h-3 w-3 mr-1" />
                      Editing
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Viewing users */}
          {viewingUsers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                <Eye className="h-4 w-4" />
                Viewing
              </h4>
              <div className="space-y-2">
                {viewingUsers.map((presence) => (
                  <div key={presence.userId} className="flex items-center gap-3">
                    <div className="relative">
                      {getUserAvatar(presence)}
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-white ${getActivityColor(
                          getActivityStatus(presence)
                        )}`}
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {presence.userName || presence.userEmail}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatLastSeen(presence.lastActivity)}
                      </p>
                    </div>
                    <Badge variant="outline" size="sm">
                      <Eye className="h-3 w-3 mr-1" />
                      Viewing
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current user */}
          <div className="border-t pt-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-medium flex items-center justify-center border-2 border-white">
                  You
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border border-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">You</p>
                <p className="text-xs text-gray-500">Active now</p>
              </div>
              <Badge variant="default" size="sm">
                <Crown className="h-3 w-3 mr-1" />
                Owner
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Cursor indicator for showing other users' cursor positions
interface CursorIndicatorProps {
  presence: PresenceData;
  position: { top: number; left: number };
}

export function CursorIndicator({ presence, position }: CursorIndicatorProps) {
  const getUserColor = (userId: string) => {
    // Generate a consistent color based on user ID
    const colors = [
      'bg-red-500',
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500',
    ];
    
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translate(-2px, -2px)',
      }}
    >
      {/* Cursor line */}
      <div className={`w-0.5 h-5 ${getUserColor(presence.userId)}`} />
      
      {/* User label */}
      <div className={`absolute top-0 left-2 px-2 py-1 text-xs text-white rounded whitespace-nowrap ${getUserColor(presence.userId)}`}>
        {presence.userName || presence.userEmail}
      </div>
    </div>
  );
}