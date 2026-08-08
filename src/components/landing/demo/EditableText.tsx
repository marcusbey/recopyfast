"use client";

import { motion } from "framer-motion";
import { Edit3 } from "lucide-react";
import { ElementTagBadge } from "@/components/editor";
import type { TypographyStyles } from "@/types/editor";
import type { EditableText as EditableTextModel } from "./types";

/**
 * The box that carries the click affordance. It is deliberately identical in
 * both branches: the read element is what gets measured, the edit element is
 * what gets pinned to that measurement, and any asymmetry between the two
 * shows up as the element changing width the instant you click it.
 *
 * The hover and selection rings are `outline`, not `border`. Outline is drawn
 * outside the box and never occupies layout, so idle, hovered, selected and
 * editing are four states with exactly one geometry — there is no border width
 * to keep in sync between the branches, and nothing for a stale measurement to
 * be off by.
 *
 * Radius is NOT set here either — it comes from the site's `textStyles` entry,
 * so a site can have square-cornered buttons without fighting a base
 * `rounded-*`.
 */
const BOX = "relative p-2 outline-2 outline-offset-2";

export interface EditableTextProps {
  item: EditableTextModel;
  /** The site's typography for this element id. Shared by both branches. */
  typographyClasses: string;
  isSelected: boolean;
  /**
   * Show the click affordance without a pointer — the hover ring and pencil,
   * drawn for a beat by the demo's attract loop. It is the same chrome hover
   * produces, on purpose: what it teaches has to be what the visitor then
   * finds. Driven from `InteractiveHero`, which walks the elements actually on
   * screen and stops the moment anybody interacts.
   */
  isHinted?: boolean;
  selectedTag: string;
  customStyles?: TypographyStyles;
  /** Read-mode `offsetWidth`, captured on click. */
  pinnedWidth?: number;
  /** Read-mode `offsetHeight`, captured on click. */
  pinnedHeight?: number;
  /** Read-mode computed colour, so editing never recolours the author's text. */
  preservedColor?: string;
  /** `"inherit"` so the textarea picks up any text-shadow the design applies. */
  preservedTextShadow?: string;
  onSelect: (id: string, element: HTMLElement) => void;
  onChange: (id: string, text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/** Maps an element id onto the HTML tag the badge should claim it is. */
function elementTagFor(id: string): string {
  if (id === "headline") return "h1";
  if (id === "cta" || id.endsWith("-btn")) return "button";
  if (id.includes("title")) return "h2";
  if (id === "brand") return "span";
  // Only the `nav-link-*` ids are navigation. `nav-since`, `nav-hours` and
  // `nav-status` share the prefix but are standing copy, not links, so the
  // check is on the full prefix rather than on "nav".
  if (id.startsWith("nav-link-")) return "a";
  if (id.includes("price") || id.includes("eyebrow")) return "span";
  return "p";
}

/**
 * One click-to-edit string.
 *
 * Defined at module scope on purpose. When this lived inside `InteractiveHero`'s
 * render body it was a new component type on every parent render, so React
 * unmounted and remounted the textarea on every keystroke and the caret jumped
 * back to the end of the string.
 */
export default function EditableText({
  item,
  typographyClasses,
  isSelected,
  isHinted = false,
  selectedTag,
  customStyles,
  pinnedWidth,
  pinnedHeight,
  preservedColor,
  preservedTextShadow,
  onSelect,
  onChange,
  onCommit,
  onCancel,
}: EditableTextProps) {
  const inlineStyles: React.CSSProperties | undefined = customStyles && {
    fontSize: customStyles.fontSize,
    fontWeight: customStyles.fontWeight,
    color: customStyles.color,
    textAlign: customStyles.textAlign,
    lineHeight: customStyles.lineHeight,
    letterSpacing: customStyles.letterSpacing,
  };

  if (item.isEditing) {
    return (
      <motion.div
        // Same box as the read state, so entering edit mode changes nothing
        // about size, padding or position.
        className={`${BOX} outline-emerald-400 ${typographyClasses}`}
        data-editing-mode="true"
        data-editable-id={item.id}
        style={{
          // Pin the box to what it measured in read mode so entering edit mode
          // cannot reflow the layout around it.
          //
          // Width matters as much as height. The edit wrapper often sits in a
          // centred flex column, where a block child is sized shrink-to-fit;
          // the textarea inside asks for `w-full`, which resolves against that
          // shrink-to-fit parent and so falls back to the textarea's intrinsic
          // `cols` width. The subheading collapsed from 672px to 265px on click
          // for exactly this reason. Pinning the measured width removes the
          // circular dependency.
          ...(pinnedWidth && pinnedWidth > 0 && { width: `${pinnedWidth}px` }),
          ...(pinnedHeight &&
            pinnedHeight > 0 && { minHeight: `${pinnedHeight}px` }),
          ...inlineStyles,
        }}
      >
        {isSelected && (
          <ElementTagBadge
            tagName={selectedTag || elementTagFor(item.id)}
            position={{ top: -24, left: -4 }}
          />
        )}

        <textarea
          value={item.text}
          onChange={(event) => onChange(item.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              onCommit();
            }
          }}
          className="w-full resize-none outline-none"
          style={{
            background: "transparent",
            border: "none",
            padding: "0",
            margin: "0",
            // A textarea is inline-block by default, so it sits on the parent's
            // text baseline and leaves descender space underneath — which made
            // the edit box a few pixels taller than the paragraph it replaced.
            display: "block",
            fontSize: customStyles?.fontSize || "inherit",
            fontFamily: "inherit",
            fontWeight: customStyles?.fontWeight || "inherit",
            fontStyle: "inherit",
            lineHeight: customStyles?.lineHeight || "inherit",
            letterSpacing: customStyles?.letterSpacing || "inherit",
            textAlign:
              (customStyles?.textAlign as React.CSSProperties["textAlign"]) ||
              "inherit",
            textDecoration: "inherit",
            textTransform: "inherit",
            color: customStyles?.color || preservedColor || "inherit",
            // "inherit" pulls the wrapper's text-shadow through, which is what
            // keeps hero copy legible over a photograph while it is being
            // edited. Sites that need it declare it in their `textStyles`.
            textShadow: preservedTextShadow || "none",
            width: "100%",
            // The WRAPPER carries minHeight (= the read element's offsetHeight,
            // which already includes its padding and border). Repeating it here
            // would double-count that chrome and grow the box on every click,
            // so the textarea simply fills the space it is given.
            minHeight: "auto",
            // A hard `height` would clip the text whenever an edit reflows to
            // more lines than the captured value allowed, so height stays auto
            // and is free to grow.
            height: "auto",
            overflow: "visible",
            resize: "none",
            wordWrap: "break-word",
            overflowWrap: "break-word",
            whiteSpace: "pre-wrap",
            direction: "ltr",
            unicodeBidi: "normal",
            writingMode: "horizontal-tb",
          }}
          rows={Math.max(1, item.text.split("\n").length)}
          autoFocus
        />

        <div className="absolute -bottom-7 left-0 rounded bg-slate-900 px-2 py-1 font-mono text-[10px] whitespace-nowrap text-white">
          ⌘↵ save · esc cancel
        </div>
      </motion.div>
    );
  }

  const activate = (element: HTMLElement) => onSelect(item.id, element);

  return (
    <div
      role="button"
      tabIndex={0}
      /**
       * This is an editor affordance, not a description of the copy, so it has
       * to say what activating it does. `aria-label` replaces the element's
       * text-derived accessible name outright — that is the point: a screen
       * reader user hearing just the sentence has no way to know it is
       * editable.
       */
      aria-label={`Edit: ${item.text.replace(/\n/g, " ")}`}
      onClick={(event) => {
        event.stopPropagation();
        activate(event.currentTarget);
      }}
      onKeyDown={(event) => {
        // Enter and Space are the two activation keys a real <button> honours.
        // Space's default action is scrolling the page, so it has to be
        // suppressed the same way a native button suppresses it.
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        activate(event.currentTarget);
      }}
      data-editable-id={item.id}
      className={`${BOX} group cursor-pointer transition-colors duration-300 focus:outline-none focus-visible:outline-dashed focus-visible:outline-emerald-400 ${
        isSelected
          ? "outline-emerald-400"
          : `hover:outline-dashed hover:outline-emerald-400/70 ${
              isHinted
                ? "outline-dashed outline-emerald-400/70"
                : "outline-transparent"
            }`
      } ${typographyClasses}`}
      style={inlineStyles}
    >
      {isSelected && (
        <ElementTagBadge
          tagName={elementTagFor(item.id)}
          position={{ top: -24, left: -4 }}
        />
      )}

      {/* Multi-line copy keeps its line breaks. `handleElementActivate` reads
          these back out via `data-line`, which is what keeps the selection
          chrome below out of the string the visitor ends up editing. */}
      {item.text.split("\n").map((line, index) => (
        <div key={index} data-line className={index > 0 ? "mt-2" : ""}>
          {line}
        </div>
      ))}

      {!isSelected && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 transition-opacity duration-300 group-hover:opacity-100 ${
            isHinted ? "opacity-100" : "opacity-0"
          }`}
        >
          <Edit3 className="h-3 w-3 text-white" />
        </div>
      )}
    </div>
  );
}
