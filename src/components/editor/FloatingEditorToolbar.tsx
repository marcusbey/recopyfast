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
  const toolbarRef = useRef<HTMLDivElement>(null);

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
        className="fixed z-[9999]"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        <div className="bg-gray-900 border border-gray-800 rounded-lg shadow-xl flex items-center">
          {/* AI Input Section */}
          <form onSubmit={handleAISubmit} className="flex items-center">
            <div className="flex items-center px-3 py-2 border-r border-gray-800">
              <Sparkles className="w-4 h-4 text-purple-400 mr-2" />
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAIInput(e.target.value)}
                placeholder="Ask for quick changes..."
                className="bg-transparent text-gray-200 text-sm placeholder-gray-500 outline-none w-48"
              />
            </div>
          </form>

          {/* Action Buttons */}
          <div className="flex items-center px-2 py-1 gap-1">
            {/* Typography Button */}
            <div className="relative">
              <button
                type="button"
                onClick={handleTypographyToggle}
                title="Typography"
                className={`p-2 rounded transition-colors ${
                  isTypographyOpen
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
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
              className="p-2 rounded text-gray-600 cursor-not-allowed"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            {/* Divider */}
            <div className="w-px h-6 bg-gray-800 mx-1" />

            {/* Save Button */}
            <button
              type="button"
              onClick={onSave}
              title="Save changes"
              className="p-2 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>

            {/* Delete/Cancel Button */}
            <button
              type="button"
              onClick={onDelete}
              title="Cancel"
              className="p-2 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(toolbarContent, document.body);
}
