/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import ReCopyFastLoader from '../ReCopyFastLoader';

// Mock script element
const mockScript = {
  src: '',
  setAttribute: jest.fn(),
  async: false,
  onload: null as (() => void) | null,
  onerror: null as (() => void) | null,
};

// Mock DOM methods
const originalCreateElement = document.createElement;
const originalAppendChild = document.body.appendChild;
const originalRemoveChild = document.body.removeChild;

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

beforeEach(() => {
  jest.clearAllMocks();
  
  // Mock createElement to return our mock script
  document.createElement = jest.fn().mockImplementation((tagName: string) => {
    if (tagName === 'script') {
      return mockScript as HTMLScriptElement;
    }
    return originalCreateElement.call(document, tagName);
  });

  // Mock appendChild
  document.body.appendChild = jest.fn();
  
  // Mock removeChild
  document.body.removeChild = jest.fn();

  // Reset window properties
  delete (window as unknown as { RECOPYFAST_API?: string }).RECOPYFAST_API;
  delete (window as unknown as { RECOPYFAST_WS?: string }).RECOPYFAST_WS;
  delete (window as unknown as { recopyfast?: { destroy(): void } }).recopyfast;
});

afterEach(() => {
  cleanup();
  
  // Restore original methods
  document.createElement = originalCreateElement;
  document.body.appendChild = originalAppendChild;
  document.body.removeChild = originalRemoveChild;
  
  jest.restoreAllMocks();
});

describe('ReCopyFastLoader', () => {
  describe('Script Loading', () => {
    it('should create and configure script element correctly', () => {
      render(<ReCopyFastLoader />);

      expect(document.createElement).toHaveBeenCalledWith('script');
      expect(mockScript.setAttribute).toHaveBeenCalledWith('data-site-id', 'demo-site-123');
      expect(mockScript.setAttribute).toHaveBeenCalledWith('data-edit-mode', 'true');
      expect(mockScript.src).toBe('/embed/recopyfast.js');
      expect(mockScript.async).toBe(true);
      expect(document.body.appendChild).toHaveBeenCalledWith(mockScript);
    });

    it('should set global window configuration', () => {
      render(<ReCopyFastLoader />);

      expect((window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API).toBe('http://localhost:3000/api');
      expect((window as unknown as { RECOPYFAST_WS: string }).RECOPYFAST_WS).toBe('http://localhost:3001');
    });

    it('should handle script load success', () => {
      render(<ReCopyFastLoader />);

      // Simulate script load
      if (mockScript.onload) {
        mockScript.onload();
      }

      expect(mockConsoleLog).toHaveBeenCalledWith('ReCopyFast script loaded successfully');
    });

    it('should handle script load error', () => {
      render(<ReCopyFastLoader />);

      // Simulate script error
      if (mockScript.onerror) {
        mockScript.onerror();
      }

      expect(mockConsoleError).toHaveBeenCalledWith('Failed to load ReCopyFast script');
    });
  });

  describe('Cleanup', () => {
    it('should remove script from DOM on unmount', () => {
      const { unmount } = render(<ReCopyFastLoader />);

      unmount();

      expect(document.body.removeChild).toHaveBeenCalledWith(mockScript);
    });

    it('should call recopyfast.destroy if available on unmount', () => {
      const mockDestroy = jest.fn();
      (window as unknown as { recopyfast: { destroy: () => void } }).recopyfast = { destroy: mockDestroy };

      const { unmount } = render(<ReCopyFastLoader />);

      unmount();

      expect(mockDestroy).toHaveBeenCalled();
    });

    it('should not throw if recopyfast is not available on unmount', () => {
      const { unmount } = render(<ReCopyFastLoader />);

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Server-side Rendering', () => {
    it('should handle server environment gracefully', () => {
      // Mock server environment by temporarily removing window
      const originalWindow = global.window;
      delete (global as { window?: Window }).window;

      expect(() => render(<ReCopyFastLoader />)).not.toThrow();
    });
  });

  describe('Component Rendering', () => {
    it('should render without visible content', () => {
      const { container } = render(<ReCopyFastLoader />);

      expect(container.firstChild).toBeNull();
    });

    it('should not throw errors during render', () => {
      expect(() => render(<ReCopyFastLoader />)).not.toThrow();
    });
  });

  describe('Multiple Instances', () => {
    it('should handle multiple component instances', () => {
      const { unmount: unmount1 } = render(<ReCopyFastLoader />);
      const { unmount: unmount2 } = render(<ReCopyFastLoader />);

      expect(document.body.appendChild).toHaveBeenCalledTimes(2);

      unmount1();
      unmount2();

      expect(document.body.removeChild).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle DOM manipulation errors gracefully', () => {
      (document.body.appendChild as jest.Mock).mockImplementation(() => {
        throw new Error('DOM error');
      });

      // The component should handle errors in DOM manipulation
      expect(() => render(<ReCopyFastLoader />)).not.toThrow();
    });

    it('should handle cleanup errors gracefully', () => {
      const { unmount } = render(<ReCopyFastLoader />);
      
      (document.body.removeChild as jest.Mock).mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Window Configuration', () => {
    it('should only set configuration in browser environment', () => {
      // Mock non-browser environment
      const originalWindow = global.window;
      delete (global as { window?: Window }).window;

      render(<ReCopyFastLoader />);

      expect(document.body.appendChild).not.toHaveBeenCalled();

      // Restore window
      (global as { window: Window }).window = originalWindow;
    });

    it('should preserve existing window properties', () => {
      (window as unknown as { existingProperty: string }).existingProperty = 'test';

      render(<ReCopyFastLoader />);

      expect((window as unknown as { existingProperty: string }).existingProperty).toBe('test');
      expect((window as unknown as { RECOPYFAST_API: string }).RECOPYFAST_API).toBe('http://localhost:3000/api');
    });
  });
});