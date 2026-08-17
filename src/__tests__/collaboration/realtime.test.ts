import { CollaborationRealtime } from "@/lib/collaboration/realtime";
import { io, type Socket } from "socket.io-client";

// Mock Socket.IO
jest.mock("socket.io-client");

type Handler = (...args: unknown[]) => void;

const handlers = new Map<string, Handler[]>();

type MockSocket = {
  connected: boolean;
  connect: jest.Mock;
  disconnect: jest.Mock;
  emit: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
};

const mockSocket: MockSocket = {
  connected: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
  emit: jest.fn(),
  on: jest.fn((event: string, callback: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), callback]);
    return mockSocket;
  }),
  off: jest.fn(),
};

/** Fire a socket event at every handler the module registered for it. */
const fireSocketEvent = (event: string, ...args: unknown[]) => {
  (handlers.get(event) ?? []).forEach((handler) => handler(...args));
};

const mockIo = io as jest.MockedFunction<typeof io>;

const SITE_ID = "site-id";

describe("CollaborationRealtime", () => {
  let collaboration: CollaborationRealtime;

  /**
   * `connect()` resolves from the socket's own "connect" handler, and every
   * other method guards on `this.socket?.connected`. A fresh instance has no
   * socket at all, so tests that exercise emit paths have to go through a real
   * connect first rather than just flipping `mockSocket.connected`.
   */
  const connectCollaboration = async (siteId = SITE_ID, authToken?: string) => {
    mockSocket.connected = true;
    const pending = collaboration.connect(siteId, authToken);
    fireSocketEvent("connect");
    return pending;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers.clear();
    mockSocket.connected = false;
    mockIo.mockReturnValue(mockSocket as unknown as Socket);
    collaboration = new CollaborationRealtime();
  });

  afterEach(() => {
    collaboration.disconnect();
  });

  describe("connect", () => {
    it("should connect to collaboration server and join the site room", async () => {
      const result = await connectCollaboration(SITE_ID, "auth-token");

      expect(result).toBe(true);
      expect(mockIo).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: { token: "auth-token" },
          // Polling removed per ADR 023 — the server refuses it, so a polling
          // fallback would only ever produce a failing connection.
          transports: ["websocket"],
          reconnection: true,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith("join-site", {
        siteId: SITE_ID,
      });
    });

    it("should notify registered connect listeners", async () => {
      const onConnect = jest.fn();
      collaboration.on("connect", onConnect);

      await connectCollaboration();

      expect(onConnect).toHaveBeenCalled();
    });

    it("should resolve false and surface the error on connect_error", async () => {
      const onError = jest.fn();
      collaboration.on("error", onError);

      const pending = collaboration.connect(SITE_ID);
      const failure = new Error("Connection failed");
      fireSocketEvent("connect_error", failure);

      await expect(pending).resolves.toBe(false);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it("should short-circuit when a connected socket already exists", async () => {
      await connectCollaboration();
      mockIo.mockClear();

      await expect(collaboration.connect(SITE_ID)).resolves.toBe(true);
      // No second socket is created.
      expect(mockIo).not.toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should disconnect from server and clear session state", async () => {
      await connectCollaboration();
      await collaboration.startEditingSession("element-id", "session-token");

      collaboration.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(collaboration.siteId).toBeNull();
      expect(collaboration.editingElementId).toBeNull();
      expect(collaboration.isConnected).toBe(false);
    });

    it("should notify registered disconnect listeners", async () => {
      await connectCollaboration();
      const onDisconnect = jest.fn();
      collaboration.on("disconnect", onDisconnect);

      collaboration.disconnect();

      expect(onDisconnect).toHaveBeenCalled();
    });
  });

  describe("startEditingSession", () => {
    it("should start editing session and emit to server", async () => {
      await connectCollaboration();

      const result = await collaboration.startEditingSession(
        "element-id",
        "session-token",
      );

      expect(result).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith("start-editing", {
        elementId: "element-id",
        sessionToken: "session-token",
        siteId: SITE_ID,
      });
    });

    it("should return false when not connected", async () => {
      const result = await collaboration.startEditingSession(
        "element-id",
        "session-token",
      );

      expect(result).toBe(false);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe("endEditingSession", () => {
    it("should end editing session", async () => {
      await connectCollaboration();
      await collaboration.startEditingSession("element-id", "session-token");

      collaboration.endEditingSession();

      expect(mockSocket.emit).toHaveBeenCalledWith("end-editing", {
        elementId: "element-id",
        sessionToken: "session-token",
        siteId: SITE_ID,
      });
      expect(collaboration.editingElementId).toBeNull();
    });

    it("should not emit when no active session", async () => {
      await connectCollaboration();

      collaboration.endEditingSession();

      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        "end-editing",
        expect.any(Object),
      );
    });
  });

  describe("sendEdit", () => {
    it("should send collaborative edit", async () => {
      await connectCollaboration();
      await collaboration.startEditingSession("element-id", "session-token");

      collaboration.sendEdit("content", { delta: "test" });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "content-edit",
        expect.objectContaining({
          elementId: "element-id",
          content: "content",
          delta: { delta: "test" },
          sessionToken: "session-token",
          timestamp: expect.any(String),
        }),
      );
    });

    it("should not send edit when no active session", async () => {
      await connectCollaboration();

      collaboration.sendEdit("content");

      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        "content-edit",
        expect.any(Object),
      );
    });
  });

  describe("updatePresence", () => {
    it("should update user presence", async () => {
      await connectCollaboration();

      collaboration.updatePresence({
        userId: "user-id",
        userEmail: "user@example.com",
        elementId: "element-id",
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "update-presence",
        expect.objectContaining({
          userId: "user-id",
          userEmail: "user@example.com",
          elementId: "element-id",
          lastActivity: expect.any(String),
        }),
      );
    });

    it("should not update presence when not connected", () => {
      collaboration.updatePresence({
        userId: "user-id",
        userEmail: "user@example.com",
      });

      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        "update-presence",
        expect.any(Object),
      );
    });
  });

  describe("updateCursor", () => {
    it("should update cursor position", async () => {
      await connectCollaboration();

      collaboration.updateCursor("element-id", 100, { start: 100, end: 105 });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "update-presence",
        expect.objectContaining({
          elementId: "element-id",
          cursorPosition: 100,
          selection: { start: 100, end: 105 },
        }),
      );
    });

    it("should update cursor without selection", async () => {
      await connectCollaboration();

      collaboration.updateCursor("element-id", 100);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "update-presence",
        expect.objectContaining({
          elementId: "element-id",
          cursorPosition: 100,
          selection: undefined,
        }),
      );
    });
  });

  describe("event listeners", () => {
    it("should forward server events to registered listeners", async () => {
      await connectCollaboration();
      const callback = jest.fn();
      collaboration.on("user-joined", callback);

      const presence = { userId: "other-user", userEmail: "other@example.com" };
      fireSocketEvent("user-joined", presence);

      expect(callback).toHaveBeenCalledWith(presence);
    });

    it("should stop forwarding after a listener is removed", async () => {
      await connectCollaboration();
      const callback = jest.fn();
      collaboration.on("user-left", callback);
      collaboration.off("user-left", callback);

      fireSocketEvent("user-left", "other-user");

      expect(callback).not.toHaveBeenCalled();
    });

    it("should not echo the local user's own content edits back to listeners", async () => {
      await connectCollaboration();
      collaboration.updatePresence({ userId: "me" });

      const callback = jest.fn();
      collaboration.on("content-editing", callback);

      fireSocketEvent("content-editing", { userId: "me", content: "mine" });
      expect(callback).not.toHaveBeenCalled();

      fireSocketEvent("content-editing", { userId: "you", content: "yours" });
      expect(callback).toHaveBeenCalledWith({
        userId: "you",
        content: "yours",
      });
    });
  });

  describe("connection status", () => {
    it("should reflect the underlying socket state", async () => {
      expect(collaboration.isConnected).toBe(false);

      await connectCollaboration();
      expect(collaboration.isConnected).toBe(true);

      mockSocket.connected = false;
      expect(collaboration.isConnected).toBe(false);
    });
  });

  describe("getters", () => {
    it("should return current site ID", async () => {
      await connectCollaboration("test-site");

      expect(collaboration.siteId).toBe("test-site");
    });

    it("should return current editing element ID", async () => {
      await connectCollaboration();
      await collaboration.startEditingSession("element-id", "token");

      expect(collaboration.editingElementId).toBe("element-id");
    });

    it("should return current presence data", async () => {
      await connectCollaboration();

      collaboration.updatePresence({
        userId: "user-id",
        userEmail: "user@example.com",
      });

      expect(collaboration.currentPresence).toEqual(
        expect.objectContaining({
          userId: "user-id",
          userEmail: "user@example.com",
        }),
      );
    });
  });
});
