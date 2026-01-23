"use client";

import { useEffect } from "react";

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

const DEMO_SITE_ID = "7e3b2d6c-1ab1-46f3-92fd-493173fa3e17";
const DEMO_STAGING_TOKEN = "test_staging_token_valid_123";

export default function ReCopyFastLoader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if we're already in staging mode
    const urlParams = new URLSearchParams(window.location.search);
    const hasStaging = urlParams.get("rcf_staging") === "1";
    const hasToken = urlParams.get("rcf_token");

    // If not in staging mode, redirect to staging URL for demo
    if (!hasStaging || !hasToken) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("rcf_staging", "1");
      newUrl.searchParams.set("rcf_token", DEMO_STAGING_TOKEN);
      window.location.replace(newUrl.toString());
      return;
    }

    // Set global configuration
    const origin = window.location.origin;
    window.RECOPYFAST_API = `${origin}/api`;
    window.RECOPYFAST_WS =
      process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001";

    // Load ReCopyFast script
    const script = document.createElement("script");
    script.src = "/embed/recopyfast.js";
    script.setAttribute("data-site-id", DEMO_SITE_ID);
    script.setAttribute("data-site-token", DEMO_STAGING_TOKEN);
    script.async = true;

    script.onload = () => {
      console.log("ReCopyFast script loaded successfully");
    };

    script.onerror = () => {
      console.error("Failed to load ReCopyFast script");
    };

    document.body.appendChild(script);

    // Cleanup function
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      if (window.recopyfast) {
        window.recopyfast.destroy();
      }
    };
  }, []);

  return null;
}
