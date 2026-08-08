"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Type, Maximize2, Check, Trash2 } from "lucide-react";
import TypographyPanel from "./TypographyPanel";
import type { TypographyStyles, ToolbarPosition } from "@/types/editor";

interface FloatingEditorToolbarProps {
  position: ToolbarPosition | null;
  styles: TypographyStyles;
  onStylesChange: (styles: Partial<TypographyStyles>) => void;
  onSave: () => void;
  onDelete: () => void;
  onAIPrompt?: (prompt: string) => void;
  isVisible: boolean;
}

/**
 * Below this the AI input and the action buttons cannot share one row.
 *
 * The strip is ~420px laid out in a single line — a 192px text input, its
 * chrome, and four icon buttons. On a 390px phone that overflows, and because
 * the toolbar is `fixed` there is nothing to scroll: the last two children,
 * Save and Cancel, simply sit off the side of the screen with no way to reach
 * them. Tailwind's `sm` breakpoint, in px so it can be compared to innerWidth.
 */
const COMPACT_VIEWPORT_PX = 640;

/**
 * Whether the viewport is too narrow for the one-row layout.
 *
 * Measured in JS rather than left to a CSS media query because the fix is to
 * render a different tree, not to hide part of this one: `display: none` would
 * still leave the input in the layout's width calculation on the row it is on,
 * and would still leave it focusable.
 */
function useIsCompactViewport(): boolean {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const update = () => setIsCompact(window.innerWidth < COMPACT_VIEWPORT_PX);

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isCompact;
}

/**
 * Main floating toolbar that appears above selected element
 * Contains AI input, typography button, and action buttons
 */
export default function FloatingEditorToolbar({
  position,
  styles,
  onStylesChange,
  onSave,
  onDelete,
  onAIPrompt,
  isVisible,
}: FloatingEditorToolbarProps) {
  const [isTypographyOpen, setIsTypographyOpen] = useState(false);
  const [aiInput, setAIInput] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isCompact = useIsCompactViewport();

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Close typography panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(event.target as Node)
      ) {
        setIsTypographyOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset state when toolbar becomes invisible
  useEffect(() => {
    if (!isVisible) {
      setIsTypographyOpen(false);
      setIsAIOpen(false);
      setAIInput("");
    }
  }, [isVisible]);

  const handleAISubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (aiInput.trim() && onAIPrompt) {
      onAIPrompt(aiInput.trim());
      setAIInput("");
    }
  };

  const handleTypographyToggle = () => {
    setIsTypographyOpen(!isTypographyOpen);
  };

  if (!mounted || !position || !isVisible) return null;

  /* One definition, two places to put it: inline on the left when there is room
     for it, and on its own row underneath when there is not. */
  const aiForm = (
    <form onSubmit={handleAISubmit} className="flex min-w-0 items-center">
      <div
        className={`flex min-w-0 flex-1 items-center px-3 py-2 ${
          isCompact ? "border-t border-border" : "border-r border-border"
        }`}
      >
        <Sparkles className="w-4 h-4 text-primary mr-2 shrink-0" />
        <input
          type="text"
          value={aiInput}
          onChange={(e) => setAIInput(e.target.value)}
          placeholder="Ask for quick changes..."
          autoFocus={isCompact}
          className="bg-transparent text-foreground text-sm placeholder:text-muted-foreground outline-none w-48 min-w-0 max-w-full"
        />
      </div>
    </form>
  );

  const toolbarContent = (
    <AnimatePresence>
      <motion.div
        ref={toolbarRef}
        initial={{
          opacity: 0,
          y: position.placement === "above" ? 8 : -8,
          scale: 0.95,
        }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: position.placement === "above" ? 8 : -8,
          scale: 0.95,
        }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        // InteractiveHero's click-outside guard looks for this marker to tell a
        // press on the toolbar from a press that should dismiss it. Without it
        // the toolbar tears itself down on mousedown and no action ever fires.
        data-editor-toolbar=""
        className="fixed z-[9999]"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        {/* max-w keeps the strip inside the viewport whatever it contains, so
            the browser can never lay an action out past the right edge of a
            screen the toolbar cannot be scrolled within. */}
        <div className="bg-card border border-border rounded-lg shadow-md flex max-w-[calc(100vw-1.5rem)] flex-col">
          <div className="flex min-w-0 items-center">
            {/* AI Input Section — inline only when the row can hold it */}
            {!isCompact && aiForm}

            {/* Action Buttons */}
            <div className="flex shrink-0 items-center px-2 py-1 gap-1">
              {/* AI toggle, standing in for the input this row cannot fit */}
              {isCompact && (
                <button
                  type="button"
                  onClick={() => setIsAIOpen(!isAIOpen)}
                  title="Ask for quick changes"
                  aria-expanded={isAIOpen}
                  className={`p-2 rounded transition-colors ${
                    isAIOpen
                      ? "bg-tone-accent-surface text-tone-accent-text"
                      : "text-primary hover:bg-surface-2"
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              )}

              {/* Typography Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleTypographyToggle}
                  title="Typography"
                  className={`p-2 rounded transition-colors ${
                    isTypographyOpen
                      ? "bg-tone-accent-surface text-tone-accent-text"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
                  }`}
                >
                  <Type className="w-4 h-4" />
                </button>

                {/* Typography Panel */}
                <TypographyPanel
                  isOpen={isTypographyOpen}
                  styles={styles}
                  onChange={onStylesChange}
                />
              </div>

              {/* Expand Button (Future Feature) */}
              <button
                type="button"
                title="Expand (Coming soon)"
                disabled
                className="p-2 rounded text-muted-foreground/50 cursor-not-allowed"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              {/* Divider */}
              <div className="w-px h-6 bg-border mx-1" />

              {/* Save Button */}
              <button
                type="button"
                onClick={onSave}
                title="Save changes"
                className="p-2 rounded text-tone-accent-text hover:bg-tone-accent-surface transition-colors"
              >
                <Check className="w-4 h-4" />
              </button>

              {/* Delete/Cancel Button */}
              <button
                type="button"
                onClick={onDelete}
                title="Cancel"
                className="p-2 rounded text-muted-foreground hover:text-tone-danger-text hover:bg-tone-danger-surface transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* The AI input, reflowed onto its own row rather than pushed off the
              side of the screen. */}
          {isCompact && isAIOpen && aiForm}
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(toolbarContent, document.body);
}
