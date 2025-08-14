'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { ContentElement, PresenceData, CollaborativeEdit } from '@/types';
import { collaborationRealtime } from '@/lib/collaboration/realtime';
import { CollaborationPermissions } from '@/lib/collaboration/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Users, 
  Save, 
  AlertCircle, 
  Lock,
  Eye,
  Edit3,
  Crown,
  Shield,
  Loader2
} from 'lucide-react';

interface CollaborativeEditorProps {
  contentElement: ContentElement;
  siteId: string;
  userId: string;
  onSave?: (content: string) => Promise<void>;
  className?: string;
}

export function CollaborativeEditor({ 
  contentElement, 
  siteId, 
  userId, 
  onSave,
  className 
}: CollaborativeEditorProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [presenceList, setPresenceList] = useState<PresenceData[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [userRole, setUserRole] = useState<string>('viewer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<any>(null);
  const [connected, setConnected] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const permissions = useRef(new CollaborationPermissions());
  const lastContent = useRef(contentElement.current_content);
  const isRemoteUpdate = useRef(false);

  // Initialize editor
  useEffect(() => {
    const editorInstance = new Editor({
      element: editorRef.current,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: 'Start editing...',
        }),
      ],
      content: contentElement.current_content,
      onUpdate: ({ editor }) => {
        if (!isRemoteUpdate.current && isEditing && sessionToken) {
          const content = editor.getHTML();
          lastContent.current = content;
          
          // Send collaborative edit
          collaborationRealtime.sendEdit(content);
          
          // Update cursor position
          const { from } = editor.state.selection;
          collaborationRealtime.updateCursor(contentElement.id, from);
        }
      },
      onSelectionUpdate: ({ editor }) => {
        if (isEditing && sessionToken) {
          const { from, to } = editor.state.selection;
          collaborationRealtime.updateCursor(
            contentElement.id, 
            from, 
            from !== to ? { start: from, end: to } : undefined
          );
        }
      },
      editable: false, // Start as non-editable until permissions are checked
    });

    setEditor(editorInstance);

    return () => {
      editorInstance.destroy();
    };
  }, [contentElement.id]);

  // Check permissions and connect to collaboration server
  useEffect(() => {
    checkPermissionsAndConnect();
  }, [contentElement.id, siteId, userId]);

  // Setup collaboration event listeners
  useEffect(() => {
    if (!connected) return;

    const handleContentEdit = (edit: CollaborativeEdit) => {
      if (edit.elementId === contentElement.id && editor && edit.userId !== userId) {
        isRemoteUpdate.current = true;
        editor.commands.setContent(edit.content);
        lastContent.current = edit.content;
        setTimeout(() => {
          isRemoteUpdate.current = false;
        }, 100);
      }
    };

    const handlePresenceUpdate = (presence: PresenceData) => {
      setPresenceList(prev => {
        const filtered = prev.filter(p => p.userId !== presence.userId);
        return [...filtered, presence];
      });
    };

    const handleUserLeft = (leftUserId: string) => {
      setPresenceList(prev => prev.filter(p => p.userId !== leftUserId));
    };

    const handlePresenceList = (users: PresenceData[]) => {
      setPresenceList(users.filter(p => p.userId !== userId));
    };

    const handleEditConflict = (conflictData: any) => {
      if (conflictData.elementId === contentElement.id) {
        setConflict(conflictData);
      }
    };

    collaborationRealtime.on('content-editing', handleContentEdit);
    collaborationRealtime.on('presence-updated', handlePresenceUpdate);
    collaborationRealtime.on('user-left', handleUserLeft);
    collaborationRealtime.on('presence-list', handlePresenceList);
    collaborationRealtime.on('edit-conflict', handleEditConflict);

    return () => {
      collaborationRealtime.off('content-editing', handleContentEdit);
      collaborationRealtime.off('presence-updated', handlePresenceUpdate);
      collaborationRealtime.off('user-left', handleUserLeft);
      collaborationRealtime.off('presence-list', handlePresenceList);
      collaborationRealtime.off('edit-conflict', handleEditConflict);
    };
  }, [connected, editor, contentElement.id, userId]);

  const checkPermissionsAndConnect = async () => {
    try {
      setLoading(true);
      
      // Check content edit permissions
      const permissionCheck = await permissions.current.checkContentEditPermission(
        userId, 
        contentElement.id
      );
      
      setHasPermission(permissionCheck.hasPermission);
      setUserRole(permissionCheck.userRole || 'viewer');
      
      // Connect to collaboration server
      const connectionSuccess = await collaborationRealtime.connect(siteId);
      setConnected(connectionSuccess);
      
      if (connectionSuccess && permissionCheck.hasPermission) {
        // Update user presence
        collaborationRealtime.updatePresence({
          userId,
          userEmail: '', // This should come from auth context
          elementId: contentElement.id,
          lastActivity: new Date().toISOString(),
        });
      }
      
    } catch (error) {
      console.error('Error checking permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const startEditing = async () => {
    if (!hasPermission || !connected) return;

    try {
      // Start editing session
      const token = await permissions.current.startEditingSession(userId, contentElement.id);
      if (!token) {
        alert('Unable to start editing session. Content may be locked by another user.');
        return;
      }

      setSessionToken(token);
      setIsEditing(true);
      
      // Enable editor
      editor?.setEditable(true);
      
      // Start collaboration session
      await collaborationRealtime.startEditingSession(contentElement.id, token);
      
      // Focus editor
      editor?.commands.focus();
      
    } catch (error) {
      console.error('Error starting editing session:', error);
      alert('Failed to start editing session');
    }
  };

  const stopEditing = async () => {
    if (!isEditing || !sessionToken) return;

    try {
      // End collaboration session
      collaborationRealtime.endEditingSession();
      
      // End editing session
      await permissions.current.endEditingSession(sessionToken);
      
      setIsEditing(false);
      setSessionToken(null);
      
      // Disable editor
      editor?.setEditable(false);
      
    } catch (error) {
      console.error('Error stopping editing session:', error);
    }
  };

  const handleSave = async () => {
    if (!editor || !isEditing || !onSave) return;

    try {
      setSaving(true);
      const content = editor.getHTML();
      await onSave(content);
      lastContent.current = content;
    } catch (error) {
      console.error('Error saving content:', error);
      alert('Failed to save content');
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = (resolution: 'keep-local' | 'keep-remote') => {
    if (!conflict || !editor) return;

    if (resolution === 'keep-remote') {
      isRemoteUpdate.current = true;
      editor.commands.setContent(conflict.baseContent);
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 100);
    }
    
    setConflict(null);
  };

  const getUserIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-3 w-3 text-yellow-500" />;
      case 'manager':
        return <Shield className="h-3 w-3 text-blue-500" />;
      case 'editor':
        return <Edit3 className="h-3 w-3 text-green-500" />;
      case 'viewer':
        return <Eye className="h-3 w-3 text-gray-500" />;
      default:
        return null;
    }
  };

  const getPresenceIndicator = (presence: PresenceData) => {
    if (presence.elementId !== contentElement.id) return null;

    return (
      <div
        key={presence.userId}
        className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
      >
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        {presence.userName || presence.userEmail}
      </div>
    );
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading editor...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={className}>
      {/* Conflict Resolution */}
      {conflict && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>Edit conflict detected. Another user has modified this content.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveConflict('keep-local')}
                >
                  Keep My Changes
                </Button>
                <Button
                  size="sm"
                  onClick={() => resolveConflict('keep-remote')}
                >
                  Use Their Changes
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Editor Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {getUserIcon(userRole)}
            <Badge variant="outline" className="capitalize">
              {userRole}
            </Badge>
          </div>
          
          {!connected && (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              Offline
            </Badge>
          )}
          
          {presenceList.length > 0 && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <div className="flex items-center gap-1">
                {presenceList.map(getPresenceIndicator).filter(Boolean)}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasPermission && (
            <>
              {!isEditing ? (
                <Button onClick={startEditing} disabled={!connected}>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    onClick={handleSave}
                    disabled={saving || !onSave}
                    variant="default"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button onClick={stopEditing} variant="outline">
                    Stop Editing
                  </Button>
                </>
              )}
            </>
          )}
          
          {!hasPermission && (
            <Badge variant="secondary">
              <Lock className="h-3 w-3 mr-1" />
              Read Only
            </Badge>
          )}
        </div>
      </div>

      {/* Editor */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={editorRef}
            className={`min-h-[200px] p-4 prose prose-sm max-w-none focus:outline-none ${
              isEditing ? 'border-2 border-blue-500 bg-blue-50' : 'bg-gray-50'
            }`}
          />
        </CardContent>
      </Card>

      {/* Status Bar */}
      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
        <div>
          {isEditing ? (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              Editing
            </span>
          ) : (
            <span>Read only</span>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {presenceList.length > 0 && (
            <span>{presenceList.length} user{presenceList.length > 1 ? 's' : ''} online</span>
          )}
          
          <span>
            Last modified: {new Date(contentElement.updated_at).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}