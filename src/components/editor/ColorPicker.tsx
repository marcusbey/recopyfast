"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { DEFAULT_COLOR_PRESETS } from "@/types/editor";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  presets?: typeof DEFAULT_COLOR_PRESETS;
}

/**
 * Color picker with preset colors and custom hex input
 */
export default function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_COLOR_PRESETS,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Update custom color when value changes
  useEffect(() => {
    setCustomColor(value);
  }, [value]);

  const handlePresetClick = (color: string) => {
    onChange(color);
    setCustomColor(color);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    // Only trigger onChange if it's a valid hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
      onChange(newColor);
    }
  };

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    onChange(newColor);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded border border-gray-600"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase">{value}</span>
        </div>
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
            className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 p-3"
          >
            {/* Color presets grid */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetClick(preset.value)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                    value === preset.value
                      ? "border-emerald-400 ring-2 ring-emerald-400/30"
                      : "border-gray-600 hover:border-gray-500"
                  }`}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-gray-700 my-3" />

            {/* Custom color input */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={customColor}
                onChange={handleNativeColorChange}
                className="w-10 h-10 rounded border border-gray-600 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={customColor}
                onChange={handleCustomColorChange}
                placeholder="#000000"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 font-mono text-xs uppercase focus:outline-none focus:border-emerald-400"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
