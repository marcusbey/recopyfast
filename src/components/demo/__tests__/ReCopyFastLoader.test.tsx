/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, cleanup } from "@testing-library/react";
import ReCopyFastLoader from "../ReCopyFastLoader";

/**
 * These must match the constants the component embeds. The loader only runs
 * when the page is already in staging mode; otherwise it rewrites the URL and
 * bails, so every test that expects a script tag has to arrange for that.
 */
const DEMO_SITE_ID = "7e3b2d6c-1ab1-46f3-92fd-493173fa3e17";
const DEMO_STAGING_TOKEN = "test_staging_token_valid_123";

const enterStagingMode = () => {
  window.history.replaceState(
    {},
    "",
    `/demo?rcf_staging=1&rcf_token=${DEMO_STAGING_TOKEN}`,
  );
};

const getInjectedScript = () =>
  document.body.querySelector<HTMLScriptElement>(
    'script[src="/embed/recopyfast.js"]',
  );

const getAllInjectedScripts = () =>
  document.body.querySelectorAll('script[src="/embed/recopyfast.js"]');

let mockConsoleLog: jest.SpyInstance;
let mockConsoleError: jest.SpyInstance;

beforeEach(() => {
  mockConsoleLog = jest.spyOn(console, "log").mockImplementation();
  // Also swallows jsdom's "Not implemented: navigation" notice, which the
  // redirect branch triggers because jsdom does not implement location.replace.
  mockConsoleError = jest.spyOn(console, "error").mockImplementation();

  delete window.RECOPYFAST_API;
  delete window.RECOPYFAST_WS;
  delete window.recopyfast;

  enterStagingMode();
});

afterEach(() => {
  cleanup();
  document
    .querySelectorAll('script[src="/embed/recopyfast.js"]')
    .forEach((node) => node.remove());
  jest.restoreAllMocks();
});

describe("ReCopyFastLoader", () => {
  // jsdom exposes `window.location` as a non-configurable, non-writable
  // property, so `location.replace` cannot be spied on. These assert the gate's
  // observable effect instead: outside staging mode nothing is injected and no
  // globals are published.
  describe("Staging gate", () => {
    it("injects nothing when the staging params are absent", () => {
      window.history.replaceState({}, "", "/demo");

      render(<ReCopyFastLoader />);

      expect(getInjectedScript()).toBeNull();
      expect(window.RECOPYFAST_API).toBeUndefined();
      expect(window.RECOPYFAST_WS).toBeUndefined();
    });

    it("injects nothing when rcf_staging is set but the token is missing", () => {
      window.history.replaceState({}, "", "/demo?rcf_staging=1");

      render(<ReCopyFastLoader />);

      expect(getInjectedScript()).toBeNull();
      expect(window.RECOPYFAST_API).toBeUndefined();
    });

    it("injects nothing when the token is present but rcf_staging is not", () => {
      window.history.replaceState(
        {},
        "",
        `/demo?rcf_token=${DEMO_STAGING_TOKEN}`,
      );

      render(<ReCopyFastLoader />);

      expect(getInjectedScript()).toBeNull();
    });
  });

  describe("Script loading", () => {
    it("injects the embed script with the demo site id and staging token", () => {
      render(<ReCopyFastLoader />);

      const script = getInjectedScript();
      expect(script).not.toBeNull();
      expect(script!.getAttribute("data-site-id")).toBe(DEMO_SITE_ID);
      expect(script!.getAttribute("data-site-token")).toBe(DEMO_STAGING_TOKEN);
      expect(script!.async).toBe(true);
    });

    it("sets the API and websocket globals from the current origin", () => {
      render(<ReCopyFastLoader />);

      expect(window.RECOPYFAST_API).toBe(`${window.location.origin}/api`);
      expect(window.RECOPYFAST_WS).toBe(
        process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001",
      );
    });

    it("logs on successful script load", () => {
      render(<ReCopyFastLoader />);

      getInjectedScript()!.onload!(new Event("load"));

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "ReCopyFast script loaded successfully",
      );
    });

    it("logs on script load failure", () => {
      render(<ReCopyFastLoader />);

      getInjectedScript()!.onerror!(new Event("error"));

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Failed to load ReCopyFast script",
      );
    });
  });

  describe("Cleanup", () => {
    it("removes the injected script on unmount", () => {
      const { unmount } = render(<ReCopyFastLoader />);
      expect(getInjectedScript()).not.toBeNull();

      unmount();

      expect(getInjectedScript()).toBeNull();
    });

    it("tears down the embed runtime on unmount when it registered itself", () => {
      const mockDestroy = jest.fn();
      window.recopyfast = { destroy: mockDestroy };

      const { unmount } = render(<ReCopyFastLoader />);
      unmount();

      expect(mockDestroy).toHaveBeenCalled();
    });

    it("unmounts cleanly when the embed runtime never loaded", () => {
      const { unmount } = render(<ReCopyFastLoader />);

      expect(() => unmount()).not.toThrow();
    });
  });

  describe("Rendering", () => {
    it("renders no visible output", () => {
      const { container } = render(<ReCopyFastLoader />);

      expect(container.firstChild).toBeNull();
    });

    it("injects one script per mounted instance and removes each on unmount", () => {
      const { unmount: unmountFirst } = render(<ReCopyFastLoader />);
      const { unmount: unmountSecond } = render(<ReCopyFastLoader />);

      expect(getAllInjectedScripts()).toHaveLength(2);

      unmountFirst();
      expect(getAllInjectedScripts()).toHaveLength(1);

      unmountSecond();
      expect(getAllInjectedScripts()).toHaveLength(0);
    });
  });
});
