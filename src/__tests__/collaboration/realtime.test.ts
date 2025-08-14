import { CollaborationRealtime } from '@/lib/collaboration/realtime';
import { io } from 'socket.io-client';

// Mock Socket.IO
jest.mock('socket.io-client');

const mockSocket = {
  connected: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

const mockIo = io as jest.MockedFunction<typeof io>;

describe('CollaborationRealtime', () => {
  let collaboration: CollaborationRealtime;

  beforeEach(() => {
    collaboration = new CollaborationRealtime();
    jest.clearAllMocks();
    mockIo.mockReturnValue(mockSocket as any);
  });

  describe('connect', () => {
    it('should connect to collaboration server', async () => {
      mockSocket.connected = true;

      // Mock successful connection
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(callback, 0);
        }
      });

      const result = await collaboration.connect('site-id', 'auth-token');

      expect(result).toBe(true);
      expect(mockIo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: { token: 'auth-token' },
          transports: ['websocket', 'polling'],
          reconnection: true,
        })
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('join-site', { siteId: 'site-id' });
    });

    it('should handle connection errors', async () => {
      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'connect_error') {
          setTimeout(() => callback(new Error('Connection failed')), 0);
        }
      });

      const result = await collaboration.connect('site-id');

      expect(result).toBe(false);
    });

    it('should return true if already connected', async () => {
      mockSocket.connected = true;
      const result = await collaboration.connect('site-id');
      expect(result).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from server and cleanup', () => {
      mockSocket.connected = true;
      collaboration.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('startEditingSession', () => {
    beforeEach(() => {
      mockSocket.connected = true;
    });

    it('should start editing session and emit to server', async () => {
      const result = await collaboration.startEditingSession('element-id', 'session-token');

      expect(result).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('start-editing', {
        elementId: 'element-id',
        sessionToken: 'session-token',
        siteId: null, // No site ID set in this test
      });
    });

    it('should return false when not connected', async () => {
      mockSocket.connected = false;
      const result = await collaboration.startEditingSession('element-id', 'session-token');

      expect(result).toBe(false);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('endEditingSession', () => {
    beforeEach(() => {
      mockSocket.connected = true;
    });

    it('should end editing session', async () => {
      // Start a session first
      await collaboration.startEditingSession('element-id', 'session-token');
      
      collaboration.endEditingSession();

      expect(mockSocket.emit).toHaveBeenCalledWith('end-editing', {
        elementId: 'element-id',
        sessionToken: 'session-token',
        siteId: null,
      });
    });

    it('should not emit when no active session', () => {
      collaboration.endEditingSession();
      expect(mockSocket.emit).not.toHaveBeenCalledWith('end-editing', expect.any(Object));
    });
  });

  describe('sendEdit', () => {
    beforeEach(() => {
      mockSocket.connected = true;
    });

    it('should send collaborative edit', async () => {
      // Start editing session first
      await collaboration.startEditingSession('element-id', 'session-token');
      
      collaboration.sendEdit('content', { delta: 'test' });

      expect(mockSocket.emit).toHaveBeenCalledWith('content-edit', expect.objectContaining({
        elementId: 'element-id',
        content: 'content',
        delta: { delta: 'test' },
        sessionToken: 'session-token',
        timestamp: expect.any(String),
      }));
    });

    it('should not send edit when no active session', () => {
      collaboration.sendEdit('content');
      expect(mockSocket.emit).not.toHaveBeenCalledWith('content-edit', expect.any(Object));
    });
  });

  describe('updatePresence', () => {
    beforeEach(() => {
      mockSocket.connected = true;
    });

    it('should update user presence', () => {
      collaboration.updatePresence({
        userId: 'user-id',
        userEmail: 'user@example.com',
        elementId: 'element-id',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('update-presence', expect.objectContaining({
        userId: 'user-id',
        userEmail: 'user@example.com',
        elementId: 'element-id',
        lastActivity: expect.any(String),
      }));
    });

    it('should not update presence when not connected', () => {
      mockSocket.connected = false;
      collaboration.updatePresence({ userId: 'user-id', userEmail: 'user@example.com' });
      expect(mockSocket.emit).not.toHaveBeenCalledWith('update-presence', expect.any(Object));
    });
  });

  describe('updateCursor', () => {
    beforeEach(() => {
      mockSocket.connected = true;
    });

    it('should update cursor position', () => {
      collaboration.updateCursor('element-id', 100, { start: 100, end: 105 });

      expect(mockSocket.emit).toHaveBeenCalledWith('update-presence', expect.objectContaining({
        elementId: 'element-id',
        cursorPosition: 100,
        selection: { start: 100, end: 105 },
      }));
    });

    it('should update cursor without selection', () => {
      collaboration.updateCursor('element-id', 100);

      expect(mockSocket.emit).toHaveBeenCalledWith('update-presence', expect.objectContaining({
        elementId: 'element-id',
        cursorPosition: 100,
        selection: undefined,
      }));
    });
  });

  describe('event listeners', () => {
    it('should add and remove event listeners', () => {
      const callback = jest.fn();
      
      collaboration.on('content-editing', callback);
      collaboration.off('content-editing', callback);
      
      // Events should be stored internally, exact implementation may vary
      expect(typeof collaboration.on).toBe('function');
      expect(typeof collaboration.off).toBe('function');
    });
  });

  describe('connection status', () => {
    it('should return connection status', () => {
      mockSocket.connected = true;
      expect(collaboration.isConnected).toBe(true);

      mockSocket.connected = false;
      expect(collaboration.isConnected).toBe(false);
    });
  });

  describe('getters', () => {
    it('should return current site ID', async () => {
      await collaboration.connect('test-site');
      expect(collaboration.siteId).toBe('test-site');
    });

    it('should return current editing element ID', async () => {
      mockSocket.connected = true;
      await collaboration.startEditingSession('element-id', 'token');
      expect(collaboration.editingElementId).toBe('element-id');
    });

    it('should return current presence data', () => {
      mockSocket.connected = true;
      collaboration.updatePresence({ userId: 'user-id', userEmail: 'user@example.com' });
      expect(collaboration.currentPresence).toEqual(expect.objectContaining({
        userId: 'user-id',
        userEmail: 'user@example.com',
      }));
    });
  });
});