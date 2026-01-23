"use client";

import { motion } from "framer-motion";

interface ElementTagBadgeProps {
  tagName: string;
  position?: {
    top: number;
    left: number;
  };
}

/**
 * Green pill badge showing the HTML element type (h1, h2, p, etc.)
 * Positioned at the top-left corner of the selected element
 */
export default function ElementTagBadge({
  tagName,
  position,
}: ElementTagBadgeProps) {
  const normalizedTag = tagName.toLowerCase();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="absolute z-50 pointer-events-none"
      style={{
        top: position?.top ?? -8,
        left: position?.left ?? -4,
      }}
    >
      <div className="bg-emerald-500 text-white text-xs font-mono uppercase px-2 py-0.5 rounded shadow-lg">
        {normalizedTag}
      </div>
    </motion.div>
  );
}
