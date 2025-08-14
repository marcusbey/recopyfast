import { io, Socket } from 'socket.io-client';
import { PresenceData, CollaborativeEdit, EditConflict } from '@/types';

export interface CollaborationEvents {
  // Presence events
  'user-joined': (presence: PresenceData) => void;
  'user-left': (userId: string) => void;
  'presence-updated': (presence: PresenceData) => void;
  'presence-list': (users: PresenceData[]) => void;
  
  // Content editing events
  'content-editing': (edit: CollaborativeEdit) => void;
  'content-saved': (elementId: string, content: string, userId: string) => void;
  'edit-conflict': (conflict: EditConflict) => void;
  'edit-session-started': (sessionData: { elementId: string; userId: string; sessionToken: string }) => void;
  'edit-session-ended': (sessionData: { elementId: string; userId: string }) => void;
  
  // Notifications
  'collaboration-notification': (notification: any) => void;
  
  // Connection events
  'connect': () => void;
  'disconnect': () => void;
  'error': (error: Error) => void;
}

export class CollaborationRealtime {
  private socket: Socket | null = null;
  private currentSiteId: string | null = null;
  private currentElementId: string | null = null;
  private currentSessionToken: string | null = null;
  private presence: PresenceData | null = null;
  private eventListeners: Map<keyof CollaborationEvents, Set<Function>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeEventListeners();
  }

  private initializeEventListeners() {
    // Initialize event listener maps
    Object.keys({
      'user-joined': true,
      'user-left': true,
      'presence-updated': true,
      'presence-list': true,
      'content-editing': true,
      'content-saved': true,
      'edit-conflict': true,
      'edit-session-started': true,
      'edit-session-ended': true,
      'collaboration-notification': true,
      'connect': true,
      'disconnect': true,
      'error': true,
    } as CollaborationEvents).forEach(event => {
      this.eventListeners.set(event as keyof CollaborationEvents, new Set());
    });
  }

  /**
   * Connect to the collaboration server
   */
  async connect(siteId: string, authToken?: string): Promise<boolean> {
    try {
      if (this.socket?.connected) {
        return true;
      }

      const serverUrl = process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_WS_URL || 'wss://your-production-ws-server.com'
        : 'ws://localhost:3001';

      this.socket = io(serverUrl, {
        auth: {
          token: authToken,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this.currentSiteId = siteId;

      // Setup socket event handlers
      this.setupSocketHandlers();

      // Join site room for collaboration
      this.socket.emit('join-site', { siteId });

      return new Promise((resolve) => {
        this.socket!.on('connect', () => {
          console.log('Connected to collaboration server');
          this.clearReconnectTimer();
          this.startHeartbeat();
          this.emit('connect');
          resolve(true);
        });

        this.socket!.on('connect_error', (error) => {
          console.error('Failed to connect to collaboration server:', error);
          this.emit('error', error);
          resolve(false);
        });
      });
    } catch (error) {
      console.error('Error connecting to collaboration server:', error);
      return false;
    }
  }

  /**
   * Disconnect from the collaboration server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.clearHeartbeat();
    this.clearReconnectTimer();
    this.currentSiteId = null;
    this.currentElementId = null;
    this.currentSessionToken = null;
    this.presence = null;
    
    this.emit('disconnect');
  }

  /**
   * Start editing a content element
   */
  async startEditingSession(elementId: string, sessionToken: string): Promise<boolean> {
    if (!this.socket?.connected) {
      console.warn('Cannot start editing session: not connected');
      return false;
    }

    try {
      this.currentElementId = elementId;
      this.currentSessionToken = sessionToken;

      // Notify server about editing session
      this.socket.emit('start-editing', {
        elementId,
        sessionToken,
        siteId: this.currentSiteId,
      });

      return true;
    } catch (error) {
      console.error('Error starting editing session:', error);
      return false;
    }
  }

  /**
   * End editing session
   */
  endEditingSession() {
    if (!this.socket?.connected || !this.currentElementId) {
      return;
    }

    this.socket.emit('end-editing', {
      elementId: this.currentElementId,
      sessionToken: this.currentSessionToken,
      siteId: this.currentSiteId,
    });

    this.currentElementId = null;
    this.currentSessionToken = null;
  }

  /**
   * Send collaborative edit
   */
  sendEdit(content: string, delta?: any) {
    if (!this.socket?.connected || !this.currentElementId || !this.currentSessionToken) {
      console.warn('Cannot send edit: no active editing session');
      return;
    }

    const edit: CollaborativeEdit = {
      elementId: this.currentElementId,
      content,
      delta,
      userId: this.presence?.userId || '',
      timestamp: new Date().toISOString(),
      sessionToken: this.currentSessionToken,
    };

    this.socket.emit('content-edit', edit);
  }

  /**
   * Update user presence
   */
  updatePresence(presence: Partial<PresenceData>) {
    if (!this.socket?.connected) {
      return;
    }

    this.presence = {
      ...this.presence,
      ...presence,
      lastActivity: new Date().toISOString(),
    } as PresenceData;

    this.socket.emit('update-presence', this.presence);
  }

  /**
   * Update cursor position for collaborative editing
   */
  updateCursor(elementId: string, cursorPosition: number, selection?: { start: number; end: number }) {
    if (!this.socket?.connected) {
      return;
    }

    this.updatePresence({
      elementId,
      cursorPosition,
      selection,
    });
  }

  /**
   * Add event listener
   */
  on<K extends keyof CollaborationEvents>(event: K, callback: CollaborationEvents[K]) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(callback);
    }
  }

  /**
   * Remove event listener
   */
  off<K extends keyof CollaborationEvents>(event: K, callback: CollaborationEvents[K]) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit<K extends keyof CollaborationEvents>(event: K, ...args: Parameters<CollaborationEvents[K]>) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          (callback as any)(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers() {
    if (!this.socket) return;

    // Connection events
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from collaboration server:', reason);
      this.emit('disconnect');
      
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try to reconnect
        this.scheduleReconnect();
      }
    });

    // Presence events
    this.socket.on('user-joined', (presence: PresenceData) => {
      this.emit('user-joined', presence);
    });

    this.socket.on('user-left', (userId: string) => {
      this.emit('user-left', userId);
    });

    this.socket.on('presence-updated', (presence: PresenceData) => {
      this.emit('presence-updated', presence);
    });

    this.socket.on('presence-list', (users: PresenceData[]) => {
      this.emit('presence-list', users);
    });

    // Content editing events
    this.socket.on('content-editing', (edit: CollaborativeEdit) => {
      // Only process edits from other users
      if (edit.userId !== this.presence?.userId) {
        this.emit('content-editing', edit);
      }
    });

    this.socket.on('content-saved', (data: { elementId: string; content: string; userId: string }) => {
      this.emit('content-saved', data.elementId, data.content, data.userId);
    });

    this.socket.on('edit-conflict', (conflict: EditConflict) => {
      this.emit('edit-conflict', conflict);
    });

    this.socket.on('edit-session-started', (data: { elementId: string; userId: string; sessionToken: string }) => {
      this.emit('edit-session-started', data);
    });

    this.socket.on('edit-session-ended', (data: { elementId: string; userId: string }) => {
      this.emit('edit-session-ended', data);
    });

    // Notification events
    this.socket.on('collaboration-notification', (notification: any) => {
      this.emit('collaboration-notification', notification);
    });

    // Error handling
    this.socket.on('error', (error: Error) => {
      console.error('Socket error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      console.log('Attempting to reconnect to collaboration server...');
      
      if (this.currentSiteId) {
        const connected = await this.connect(this.currentSiteId);
        if (!connected) {
          // Schedule another attempt
          this.reconnectTimer = null;
          this.scheduleReconnect();
        }
      }
    }, 5000);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start heartbeat to maintain connection
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
        
        // Update activity timestamp in presence
        if (this.presence) {
          this.updatePresence({});
        }
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get connection status
   */
  get isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get current site ID
   */
  get siteId(): string | null {
    return this.currentSiteId;
  }

  /**
   * Get current editing element ID
   */
  get editingElementId(): string | null {
    return this.currentElementId;
  }

  /**
   * Get current presence data
   */
  get currentPresence(): PresenceData | null {
    return this.presence;
  }
}

// Singleton instance for global use
export const collaborationRealtime = new CollaborationRealtime();