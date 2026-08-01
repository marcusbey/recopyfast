"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ToolbarPosition } from "@/types/editor";

interface UseFloatingPositionOptions {
  elementBounds: DOMRect | null;
  toolbarHeight?: number;
  toolbarWidth?: number;
  offset?: number;
  containerRef?: React.RefObject<HTMLElement | null>;
}

interface UseFloatingPositionReturn {
  position: ToolbarPosition | null;
  updatePosition: () => void;
}

/**
 * Hook for calculating smart positioning of floating toolbar
 * Automatically flips position if near viewport edges
 */
export function useFloatingPosition({
  elementBounds,
  toolbarHeight = 48,
  toolbarWidth = 400,
  offset = 12,
  containerRef,
}: UseFloatingPositionOptions): UseFloatingPositionReturn {
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const rafRef = useRef<number | null>(null);

  const calculatePosition = useCallback(() => {
    if (!elementBounds) {
      setPosition(null);
      return;
    }

    // Get viewport dimensions
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Get container bounds if available
    let containerTop = 0;
    let containerLeft = 0;
    let containerRight = viewportWidth;

    if (containerRef?.current) {
      const containerBounds = containerRef.current.getBoundingClientRect();
      containerTop = containerBounds.top;
      containerLeft = containerBounds.left;
      containerRight = containerBounds.right;
    }

    // Calculate available space above and below element
    const spaceAbove = elementBounds.top - containerTop;
    const spaceBelow = viewportHeight - elementBounds.bottom;

    // Determine vertical placement
    const placement: "above" | "below" =
      spaceAbove >= toolbarHeight + offset || spaceAbove > spaceBelow
        ? "above"
        : "below";

    // Calculate vertical position
    let top: number;
    if (placement === "above") {
      top = elementBounds.top - toolbarHeight - offset;
      // Ensure toolbar doesn't go above container/viewport
      if (top < containerTop + offset) {
        top = containerTop + offset;
      }
    } else {
      top = elementBounds.bottom + offset;
      // Ensure toolbar doesn't go below viewport
      if (top + toolbarHeight > viewportHeight - offset) {
        top = viewportHeight - toolbarHeight - offset;
      }
    }

    // Calculate horizontal position (centered on element)
    let left = elementBounds.left + elementBounds.width / 2 - toolbarWidth / 2;

    // Ensure toolbar stays within bounds horizontally
    const minLeft = containerLeft + offset;
    const maxLeft = containerRight - toolbarWidth - offset;

    if (left < minLeft) {
      left = minLeft;
    } else if (left > maxLeft) {
      left = maxLeft;
    }

    // Ensure minimum distance from viewport edges
    left = Math.max(
      offset,
      Math.min(left, viewportWidth - toolbarWidth - offset),
    );

    setPosition({ top, left, placement });
  }, [elementBounds, toolbarHeight, toolbarWidth, offset, containerRef]);

  const updatePosition = useCallback(() => {
    // Cancel any pending animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    // Schedule position update on next frame for smooth updates
    rafRef.current = requestAnimationFrame(() => {
      calculatePosition();
    });
  }, [calculatePosition]);

  // Calculate initial position and update on element bounds change
  useEffect(() => {
    calculatePosition();
  }, [calculatePosition]);

  // Update position on scroll and resize
  useEffect(() => {
    if (!elementBounds) return;

    const handleScroll = () => {
      updatePosition();
    };

    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    // Also listen for scroll on any scrollable parent
    const scrollableParent = findScrollableParent(document.body);
    if (scrollableParent && scrollableParent !== window) {
      scrollableParent.addEventListener("scroll", handleScroll, {
        passive: true,
      });
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (scrollableParent && scrollableParent !== window) {
        scrollableParent.removeEventListener("scroll", handleScroll);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [elementBounds, updatePosition]);

  return { position, updatePosition };
}

/**
 * Find the first scrollable parent element
 */
function findScrollableParent(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowX === "auto" ||
      overflowX === "scroll"
    ) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return window;
}

export default useFloatingPosition;
