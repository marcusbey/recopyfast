'use client';

import { useEffect } from 'react';

// Extend Window interface for ReCopyFast globals
declare global {
  interface Window {
    RECOPYFAST_API?: string;
    RECOPYFAST_WS?: string;
    recopyfast?: {
      destroy: () => void;
    };
  }
}

export default function ReCopyFastLoader() {
  useEffect(() => {
    // Set global configuration
    if (typeof window !== 'undefined') {
      window.RECOPYFAST_API = 'http://localhost:3000/api';
      window.RECOPYFAST_WS = 'http://localhost:3001';
      
      // Load ReCopyFast script
      const script = document.createElement('script');
      script.src = '/embed/recopyfast.js';
      script.setAttribute('data-site-id', 'demo-site-123');
      script.setAttribute('data-edit-mode', 'true');
      script.async = true;
      
      script.onload = () => {
        console.log('ReCopyFast script loaded successfully');
      };
      
      script.onerror = () => {
        console.error('Failed to load ReCopyFast script');
      };
      
      document.body.appendChild(script);
      
      // Cleanup function
      return () => {
        document.body.removeChild(script);
        if (window.recopyfast) {
          window.recopyfast.destroy();
        }
      };
    }
  }, []);

  return null;
}