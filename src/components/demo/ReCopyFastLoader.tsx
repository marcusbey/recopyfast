'use client';

import { useEffect } from 'react';

export default function ReCopyFastLoader() {
  useEffect(() => {
    // Set global configuration
    if (typeof window !== 'undefined') {
      (window as any).RECOPYFAST_API = 'http://localhost:3000/api';
      (window as any).RECOPYFAST_WS = 'http://localhost:3001';
      
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
        if ((window as any).recopyfast) {
          (window as any).recopyfast.destroy();
        }
      };
    }
  }, []);

  return null;
}