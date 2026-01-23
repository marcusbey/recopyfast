"use client";

import { motion, AnimatePresence } from "framer-motion";

interface UnsavedChangesBarProps {
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onDiscard: () => void;
  changeCount?: number;
}

/**
 * Fixed bottom bar that appears when there are unsaved changes
 * Shows save and discard actions
 */
export default function UnsavedChangesBar({
  hasUnsavedChanges,
  onSave,
  onDiscard,
  changeCount = 0,
}: UnsavedChangesBarProps) {
  return (
    <AnimatePresence>
      {hasUnsavedChanges && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-0 left-0 right-0 z-50"
        >
          <div className="bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-lg shadow-gray-200/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                {/* Message */}
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  <span className="text-gray-700 font-medium">
                    You have unsaved changes
                  </span>
                  {changeCount > 0 && (
                    <span className="text-gray-500 text-sm">
                      ({changeCount} {changeCount === 1 ? "change" : "changes"})
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onDiscard}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors font-medium text-sm"
                  >
                    Discard
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onSave}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium text-sm shadow-sm"
                  >
                    Save Changes
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
