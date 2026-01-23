"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import { FONT_SIZES, FONT_SIZE_LABELS, type FontSizeKey } from "@/types/editor";

interface FontSizeSelectorProps {
  value: string;
  onChange: (size: string) => void;
}

/**
 * Dropdown selector for font size with Tailwind-like size options
 */
export default function FontSizeSelector({
  value,
  onChange,
}: FontSizeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find current size key from value
  const currentSizeKey = (Object.entries(FONT_SIZES).find(
    ([, size]) => size === value,
  )?.[0] || "base") as FontSizeKey;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (sizeKey: FontSizeKey) => {
    onChange(FONT_SIZES[sizeKey]);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors text-sm"
      >
        <span>{FONT_SIZE_LABELS[currentSizeKey]}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
          >
            {(Object.keys(FONT_SIZES) as FontSizeKey[]).map((sizeKey) => (
              <button
                key={sizeKey}
                onClick={() => handleSelect(sizeKey)}
                className={`flex items-center justify-between w-full px-3 py-2 text-sm transition-colors ${
                  sizeKey === currentSizeKey
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    style={{ fontSize: FONT_SIZES[sizeKey] }}
                    className="w-6 h-6 flex items-center justify-center text-gray-500"
                  >
                    A
                  </span>
                  <span>{FONT_SIZE_LABELS[sizeKey]}</span>
                </span>
                {sizeKey === currentSizeKey && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
