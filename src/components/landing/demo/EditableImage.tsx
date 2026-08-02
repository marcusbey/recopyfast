"use client";

import { useCallback, useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, Shuffle, Sparkles, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface EditableImageProps {
  /** Currently displayed photo. Owned by `InteractiveHero`, not by this component. */
  src: string;
  /** Every photo available for this slot. "Shuffle" walks it. */
  pool: readonly string[];
  alt: string;
  /** Classes for the `<img>` itself. */
  className: string;
  /**
   * Positioning for the wrapper, which is always the img's containing block.
   * Defaults to `"relative"`; full-bleed slots pass `"absolute inset-0"`.
   *
   * It has to replace the default rather than be appended to it: Tailwind emits
   * `.absolute` before `.relative`, so `"relative absolute"` resolves to
   * `position: relative` no matter which order the classes are written in.
   */
  wrapperClassName?: string;
  onReplace: (nextSrc: string) => void;
}

/**
 * A click-to-replace photograph.
 *
 * The displayed source is a prop rather than local state on purpose: this used
 * to hold its own `useState`, and because the component was declared inside
 * `InteractiveHero`'s render body it was remounted on every parent render, so a
 * replaced photo silently reverted the next time anything else changed.
 */
export default function EditableImage({
  src,
  pool,
  alt,
  className,
  wrapperClassName = "relative",
  onReplace,
}: EditableImageProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const titleId = useId();
  const closeModal = useCallback(() => setIsModalOpen(false), []);
  const dialogRef = useFocusTrap<HTMLDivElement>(isModalOpen, closeModal);
  const [prompt, setPrompt] = useState("");

  const shuffle = () => {
    const index = pool.indexOf(src);
    const next = pool[(index + 1) % pool.length] ?? pool[0];
    onReplace(next);
    setIsModalOpen(false);
  };

  const requestAiImage = () => {
    // Generating a new image is a signed-in feature; the demo gates it rather
    // than pretending. (The old code called `source.unsplash.com`, an endpoint
    // Unsplash retired, so "generate" quietly produced nothing at all.)
    window.open(
      "/login?redirectedFrom=" + encodeURIComponent(window.location.href),
      "_blank",
      "width=500,height=600",
    );
  };

  return (
    <>
      <div className={`group overflow-hidden ${wrapperClassName}`}>
        <motion.img
          key={src}
          src={src}
          alt={alt}
          className={className}
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        />

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="absolute inset-0 flex cursor-pointer items-center justify-center bg-slate-950/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        >
          <span className="flex items-center gap-2 border border-white/25 bg-white/95 px-4 py-2 text-[13px] font-medium text-slate-900">
            <ImagePlus className="h-4 w-4" />
            Replace image
          </span>
        </button>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3
                  id={titleId}
                  className="text-[15px] font-semibold text-slate-900"
                >
                  Replace image
                </h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-slate-200 bg-slate-50 p-5">
                <img
                  src={src}
                  alt={alt}
                  className="h-40 w-full rounded-md border border-slate-200 object-cover"
                />
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <label
                    htmlFor="demo-image-prompt"
                    className="mb-2 block text-[13px] font-medium text-slate-700"
                  >
                    Describe the image you want
                  </label>
                  <textarea
                    id="demo-image-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Fresh pasta on a marble counter, morning light"
                    rows={2}
                    className="w-full resize-none rounded-md border border-slate-300 bg-white p-3 text-[13px] text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={requestAiImage}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-[13px] font-medium text-white transition-colors hover:bg-slate-800"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate with AI
                  <span className="ml-1 rounded bg-white/15 px-1.5 py-0.5 text-[11px]">
                    Sign in
                  </span>
                </button>

                <button
                  type="button"
                  onClick={shuffle}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-3 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                >
                  <Shuffle className="h-4 w-4" />
                  Use the next photo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
