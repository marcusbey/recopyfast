import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server, MockWebSocket } from './setup';
import ReCopyFastLoader from '@/components/demo/ReCopyFastLoader';

// Mock window and document globals
const mockAppendChild = jest.fn();
const mockRemoveChild = jest.fn();
const mockCreateElement = jest.fn();

// Setup DOM container for testing
beforeAll(() => {
  // Ensure we have a proper DOM container
  if (!document.body) {
    document.body = document.createElement('body');
  }
});

Object.defineProperty(document, 'createElement', {
  value: mockCreateElement,
  configurable: true,
});

Object.defineProperty(document.body, 'appendChild', {
  value: mockAppendChild,
  configurable: true,
});

Object.defineProperty(document.body, 'removeChild', {
  value: mockRemoveChild,
  configurable: true,
});

describe('Demo Page Integration', () => {
  beforeAll(() => {
    server.listen();
    MockWebSocket.mockImplementation();
  });

  afterEach(() => {
    server.resetHandlers();
    MockWebSocket.cleanup();
    jest.clearAllMocks();
    
    // Reset document mock
    mockCreateElement.mockReturnValue({
      src: '',
      setAttribute: jest.fn(),
      async: false,
      onload: null,
      onerror: null,
    });
  });

  afterAll(() => {
    server.close();
  });

  describe('ReCopyFast Script Loading', () => {
    it('should load ReCopyFast script with correct configuration', () => {
      const mockScript = {
        src: '',
        setAttribute: jest.fn(),
        async: false,
        onload: null,
        onerror: null,
      };

      mockCreateElement.mockReturnValue(mockScript);

      render(<ReCopyFastLoader />);

      // Verify script creation
      expect(mockCreateElement).toHaveBeenCalledWith('script');
      
      // Verify script configuration
      expect(mockScript.src).toBe('/embed/recopyfast.js');
      expect(mockScript.setAttribute).toHaveBeenCalledWith('data-site-id', 'demo-site-123');
      expect(mockScript.setAttribute).toHaveBeenCalledWith('data-site-token', 'demo-site-token');
      expect(mockScript.setAttribute).toHaveBeenCalledWith('data-edit-mode', 'true');
      expect(mockScript.async).toBe(true);

      // Verify script appended to body
      expect(mockAppendChild).toHaveBeenCalledWith(mockScript);
    });

    it('should set global configuration variables', () => {
      render(<ReCopyFastLoader />);

      // Verify global variables are set
      expect(window.RECOPYFAST_API).toBe('http://localhost:3000/api');
      expect(window.RECOPYFAST_WS).toBe('http://localhost:3001');
    });

    it('should handle script load success', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockScript = {
        src: '',
        setAttribute: jest.fn(),
        async: false,
        onload: null,
        onerror: null,
      };

      mockCreateElement.mockReturnValue(mockScript);

      render(<ReCopyFastLoader />);

      // Simulate script load success
      if (mockScript.onload) {
        mockScript.onload(new Event('load'));
      }

      expect(consoleSpy).toHaveBeenCalledWith('ReCopyFast script loaded successfully');
      
      consoleSpy.mockRestore();
    });

    it('should handle script load error', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const mockScript = {
        src: '',
        setAttribute: jest.fn(),
        async: false,
        onload: null,
        onerror: null,
      };

      mockCreateElement.mockReturnValue(mockScript);

      render(<ReCopyFastLoader />);

      // Simulate script load error
      if (mockScript.onerror) {
        mockScript.onerror(new Event('error'));
      }

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load ReCopyFast script');
      
      consoleSpy.mockRestore();
    });

    it('should cleanup script on component unmount', () => {
      const mockScript = {
        src: '',
        setAttribute: jest.fn(),
        async: false,
        onload: null,
        onerror: null,
      };

      mockCreateElement.mockReturnValue(mockScript);

      const { unmount } = render(<ReCopyFastLoader />);

      // Verify script was added
      expect(mockAppendChild).toHaveBeenCalledWith(mockScript);

      // Unmount component
      unmount();

      // Verify script was removed
      expect(mockRemoveChild).toHaveBeenCalledWith(mockScript);
    });

    it('should cleanup ReCopyFast instance on unmount', () => {
      const mockDestroy = jest.fn();
      window.recopyfast = { destroy: mockDestroy };

      const mockScript = {
        src: '',
        setAttribute: jest.fn(),
        async: false,
        onload: null,
        onerror: null,
      };

      mockCreateElement.mockReturnValue(mockScript);

      const { unmount } = render(<ReCopyFastLoader />);

      // Unmount component
      unmount();

      // Verify ReCopyFast instance was destroyed
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('Demo Page Mock Integration', () => {
    // Mock DemoPage component that uses ReCopyFastLoader
    const MockDemoPage = () => {
      const [isScriptLoaded, setIsScriptLoaded] = React.useState(false);
      const [editableElements, setEditableElements] = React.useState([
        { id: 'demo-title', content: 'Demo Page Title', editable: false },
        { id: 'demo-subtitle', content: 'This is a demo subtitle', editable: false },
        { id: 'demo-content', content: 'Demo content that can be edited', editable: false }
      ]);

      React.useEffect(() => {
        // Simulate script load detection
        const timer = setTimeout(() => {
          setIsScriptLoaded(true);
          // Make elements editable
          setEditableElements(prev => 
            prev.map(el => ({ ...el, editable: true }))
          );
        }, 100);

        return () => clearTimeout(timer);
      }, []);

      const handleElementEdit = (id: string, newContent: string) => {
        setEditableElements(prev =>
          prev.map(el => el.id === id ? { ...el, content: newContent } : el)
        );
      };

      return (
        <div data-testid="demo-page">
          <ReCopyFastLoader />
          
          <div data-testid="script-status">
            Script Loaded: {isScriptLoaded ? 'Yes' : 'No'}
          </div>

          <div data-testid="editable-content">
            {editableElements.map(element => (
              <div
                key={element.id}
                data-testid={`element-${element.id}`}
                className={element.editable ? 'editable' : ''}
              >
                {element.editable ? (
                  <input
                    value={element.content}
                    onChange={(e) => handleElementEdit(element.id, e.target.value)}
                    data-testid={`input-${element.id}`}
                  />
                ) : (
                  <span data-testid={`span-${element.id}`}>{element.content}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    };

    it('should render demo page with ReCopyFast integration', async () => {
      render(<MockDemoPage />);

      // Initially script not loaded
      expect(screen.getByText('Script Loaded: No')).toBeInTheDocument();

      // Elements should be static initially
      expect(screen.getByTestId('span-demo-title')).toBeInTheDocument();
      expect(screen.getByTestId('span-demo-subtitle')).toBeInTheDocument();
      expect(screen.getByTestId('span-demo-content')).toBeInTheDocument();

      // Wait for script to "load"
      await waitFor(() => {
        expect(screen.getByText('Script Loaded: Yes')).toBeInTheDocument();
      });

      // Elements should become editable
      expect(screen.getByTestId('input-demo-title')).toBeInTheDocument();
      expect(screen.getByTestId('input-demo-subtitle')).toBeInTheDocument();
      expect(screen.getByTestId('input-demo-content')).toBeInTheDocument();
    });

    it('should enable real-time editing after script loads', async () => {
      render(<MockDemoPage />);

      // Wait for script to load
      await waitFor(() => {
        expect(screen.getByText('Script Loaded: Yes')).toBeInTheDocument();
      });

      // Edit title
      const titleInput = screen.getByTestId('input-demo-title');
      fireEvent.change(titleInput, {
        target: { value: 'Updated Demo Title' }
      });

      expect(titleInput).toHaveValue('Updated Demo Title');

      // Edit content
      const contentInput = screen.getByTestId('input-demo-content');
      fireEvent.change(contentInput, {
        target: { value: 'Updated demo content with real-time editing' }
      });

      expect(contentInput).toHaveValue('Updated demo content with real-time editing');
    });
  });

  describe('WebSocket Integration for Real-Time Features', () => {
    // Mock component that simulates WebSocket communication
    const MockRealTimeDemo = () => {
      const [connectionStatus, setConnectionStatus] = React.useState('disconnected');
      const [messages, setMessages] = React.useState<string[]>([]);
      const [websocket, setWebsocket] = React.useState<MockWebSocket | null>(null);

      React.useEffect(() => {
        // Simulate WebSocket connection
        const ws = new MockWebSocket('ws://localhost:3001');
        
        ws.onopen = () => {
          setConnectionStatus('connected');
        };

        ws.onmessage = (event) => {
          setMessages(prev => [...prev, event.data]);
        };

        ws.onerror = () => {
          setConnectionStatus('error');
        };

        ws.onclose = () => {
          setConnectionStatus('disconnected');
        };

        setWebsocket(ws);

        return () => {
          ws.close();
        };
      }, []);

      const sendMessage = (message: string) => {
        if (websocket && connectionStatus === 'connected') {
          websocket.send(message);
        }
      };

      return (
        <div data-testid="realtime-demo">
          <div data-testid="connection-status">
            Status: {connectionStatus}
          </div>
          
          <button
            onClick={() => sendMessage('element-updated')}
            data-testid="send-update"
            disabled={connectionStatus !== 'connected'}
          >
            Send Update
          </button>

          <div data-testid="message-list">
            {messages.map((message, index) => (
              <div key={index} data-testid={`message-${index}`}>
                {message}
              </div>
            ))}
          </div>
        </div>
      );
    };

    it('should establish WebSocket connection for real-time features', async () => {
      render(<MockRealTimeDemo />);

      // Initially disconnected
      expect(screen.getByText('Status: disconnected')).toBeInTheDocument();

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Status: connected')).toBeInTheDocument();
      });

      // Send button should be enabled
      expect(screen.getByTestId('send-update')).not.toBeDisabled();
    });

    it('should handle real-time message communication', async () => {
      render(<MockRealTimeDemo />);

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Status: connected')).toBeInTheDocument();
      });

      // Send message
      fireEvent.click(screen.getByTestId('send-update'));

      // Wait for echo response
      await waitFor(() => {
        expect(screen.getByTestId('message-0')).toBeInTheDocument();
      });

      expect(screen.getByTestId('message-0')).toHaveTextContent('element-updated');
    });

    it('should handle multiple real-time messages', async () => {
      render(<MockRealTimeDemo />);

      // Wait for connection
      await waitFor(() => {
        expect(screen.getByText('Status: connected')).toBeInTheDocument();
      });

      // Send multiple messages
      fireEvent.click(screen.getByTestId('send-update'));
      fireEvent.click(screen.getByTestId('send-update'));
      fireEvent.click(screen.getByTestId('send-update'));

      // Wait for all messages
      await waitFor(() => {
        expect(screen.getByTestId('message-2')).toBeInTheDocument();
      });

      expect(screen.getByTestId('message-0')).toHaveTextContent('element-updated');
      expect(screen.getByTestId('message-1')).toHaveTextContent('element-updated');
      expect(screen.getByTestId('message-2')).toHaveTextContent('element-updated');
    });
  });

  describe('Complete Demo Page Workflow', () => {
    // Comprehensive demo page integration
    const MockCompleteDemoPage = () => {
      const [scriptLoaded, setScriptLoaded] = React.useState(false);
      const [wsConnected, setWsConnected] = React.useState(false);
      const [elements, setElements] = React.useState([
        { id: 'header', content: 'Welcome to ReCopyFast Demo', selector: '#header' },
        { id: 'description', content: 'Experience real-time content editing', selector: '.description' }
      ]);
      const [editHistory, setEditHistory] = React.useState<string[]>([]);

      React.useEffect(() => {
        // Simulate script loading
        const scriptTimer = setTimeout(() => {
          setScriptLoaded(true);
        }, 100);

        // Simulate WebSocket connection
        const wsTimer = setTimeout(() => {
          setWsConnected(true);
        }, 200);

        return () => {
          clearTimeout(scriptTimer);
          clearTimeout(wsTimer);
        };
      }, []);

      const handleEdit = (id: string, newContent: string) => {
        const timestamp = new Date().toISOString();
        setElements(prev =>
          prev.map(el => el.id === id ? { ...el, content: newContent } : el)
        );
        setEditHistory(prev => [...prev, `${timestamp}: ${id} updated`]);
      };

      const isReady = scriptLoaded && wsConnected;

      return (
        <div data-testid="complete-demo">
          <ReCopyFastLoader />
          
          <div data-testid="demo-status">
            <div>Script: {scriptLoaded ? 'Loaded' : 'Loading...'}</div>
            <div>WebSocket: {wsConnected ? 'Connected' : 'Connecting...'}</div>
            <div>Ready: {isReady ? 'Yes' : 'No'}</div>
          </div>

          {isReady && (
            <div data-testid="demo-content">
              <h1>Live Demo</h1>
              {elements.map(element => (
                <div key={element.id} data-testid={`demo-element-${element.id}`}>
                  <label>{element.selector}:</label>
                  <input
                    value={element.content}
                    onChange={(e) => handleEdit(element.id, e.target.value)}
                    data-testid={`demo-input-${element.id}`}
                  />
                </div>
              ))}
              
              <div data-testid="edit-history">
                <h3>Edit History</h3>
                {editHistory.map((entry, index) => (
                  <div key={index} data-testid={`history-${index}`}>
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    };

    it('should complete full demo page initialization workflow', async () => {
      render(<MockCompleteDemoPage />);

      // Initial state
      expect(screen.getByText('Script: Loading...')).toBeInTheDocument();
      expect(screen.getByText('WebSocket: Connecting...')).toBeInTheDocument();
      expect(screen.getByText('Ready: No')).toBeInTheDocument();

      // Demo content should not be visible yet
      expect(screen.queryByText('Live Demo')).not.toBeInTheDocument();

      // Wait for script to load
      await waitFor(() => {
        expect(screen.getByText('Script: Loaded')).toBeInTheDocument();
      });

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(screen.getByText('WebSocket: Connected')).toBeInTheDocument();
      });

      // System should be ready
      expect(screen.getByText('Ready: Yes')).toBeInTheDocument();

      // Demo content should be visible
      expect(screen.getByText('Live Demo')).toBeInTheDocument();
      expect(screen.getByTestId('demo-input-header')).toBeInTheDocument();
      expect(screen.getByTestId('demo-input-description')).toBeInTheDocument();
    });

    it('should handle complete editing workflow with history tracking', async () => {
      render(<MockCompleteDemoPage />);

      // Wait for system to be ready
      await waitFor(() => {
        expect(screen.getByText('Ready: Yes')).toBeInTheDocument();
      });

      // Edit header
      const headerInput = screen.getByTestId('demo-input-header');
      fireEvent.change(headerInput, {
        target: { value: 'Updated Header Content' }
      });

      // Edit description
      const descInput = screen.getByTestId('demo-input-description');
      fireEvent.change(descInput, {
        target: { value: 'Updated description with new content' }
      });

      // Check that history is tracked
      await waitFor(() => {
        expect(screen.getByTestId('history-0')).toBeInTheDocument();
      });

      expect(screen.getByTestId('history-0')).toHaveTextContent('header updated');
      expect(screen.getByTestId('history-1')).toHaveTextContent('description updated');

      // Verify content is updated
      expect(headerInput).toHaveValue('Updated Header Content');
      expect(descInput).toHaveValue('Updated description with new content');
    });

    it('should maintain state consistency throughout demo session', async () => {
      render(<MockCompleteDemoPage />);

      // Wait for initialization
      await waitFor(() => {
        expect(screen.getByText('Ready: Yes')).toBeInTheDocument();
      });

      // Perform multiple edits
      const headerInput = screen.getByTestId('demo-input-header');
      
      fireEvent.change(headerInput, { target: { value: 'First Update' } });
      fireEvent.change(headerInput, { target: { value: 'Second Update' } });
      fireEvent.change(headerInput, { target: { value: 'Final Update' } });

      // Wait for all history entries
      await waitFor(() => {
        expect(screen.getByTestId('history-2')).toBeInTheDocument();
      });

      // Verify final state
      expect(headerInput).toHaveValue('Final Update');
      expect(screen.getAllByText(/header updated/)).toHaveLength(3);
    });
  });
});

// Add React import for JSX
import React from 'react';
