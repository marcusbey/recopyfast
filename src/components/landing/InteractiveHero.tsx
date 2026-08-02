"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { FloatingEditorToolbar, UnsavedChangesBar } from "@/components/editor";
import { useFloatingPosition } from "@/lib/hooks/useFloatingPosition";
import type { PendingChange, TypographyStyles } from "@/types/editor";
import BellaVistaSite from "./demo/BellaVistaSite";
import BrowserChrome from "./demo/BrowserChrome";
import EditableImage from "./demo/EditableImage";
import EditableText from "./demo/EditableText";
import PremiumAutoSpaSite from "./demo/PremiumAutoSpaSite";
import SweetDreamsSite from "./demo/SweetDreamsSite";
import { demoSites } from "./demo/demoSites";
import type {
  DemoSite,
  DemoSiteRenderProps,
  EditableText as EditableTextModel,
} from "./demo/types";

const SITE_LAYOUTS: Record<string, ComponentType<DemoSiteRenderProps>> = {
  restaurant: BellaVistaSite,
  carwash: PremiumAutoSpaSite,
  bakery: SweetDreamsSite,
};

const DEFAULT_STYLES: TypographyStyles = {
  fontSize: "1rem",
  fontWeight: "400",
  color: "#000000",
  textAlign: "left",
};

/** Matches `--ease-out` in globals.css. */
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Direction-aware slide. `custom` carries +1 (moved forward) or -1 (moved
 * back); it is derived from the index delta at the call site, so the tab
 * buttons and the arrows both slide the way the user actually travelled.
 *
 * Exit only travels 35% while enter travels the full width — the outgoing site
 * reads as being pushed off rather than racing away, which is what stops a
 * sub-half-second transition from feeling twitchy.
 */
const slideVariants = {
  enter: (direction: number) => ({
    x: direction >= 0 ? "100%" : "-100%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
    transition: { duration: 0.26, ease: EASE },
  },
  exit: (direction: number) => ({
    x: direction >= 0 ? "-35%" : "35%",
    opacity: 0,
    transition: { duration: 0.16, ease: EASE },
  }),
};

/** `prefers-reduced-motion` fallback: no travel, just a short cross-fade. */
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export default function InteractiveHero() {
  const [currentSite, setCurrentSite] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0);

  /**
   * Copy is held per site rather than as one flat list, for two reasons: the
   * slide leaves the outgoing site on screen for ~180ms after the index has
   * already moved on, and a visitor who edits the restaurant, looks at the
   * bakery and comes back expects to find their edit still there.
   */
  const [textsBySite, setTextsBySite] = useState<
    Record<string, EditableTextModel[]>
  >(() =>
    Object.fromEntries(demoSites.map((site) => [site.id, site.editableTexts])),
  );
  /** Chosen photo per `siteId:slot`. Absent means "the slot's first photo". */
  const [imageSources, setImageSources] = useState<Record<string, string>>({});

  // Transient per-click capture, cleared whenever the site changes.
  const [preservedColors, setPreservedColors] = useState<
    Record<string, string>
  >({});
  const [preservedShadows, setPreservedShadows] = useState<
    Record<string, string>
  >({});
  const [originalHeights, setOriginalHeights] = useState<
    Record<string, number>
  >({});
  const [originalWidths, setOriginalWidths] = useState<Record<string, number>>(
    {},
  );

  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [selectedElementBounds, setSelectedElementBounds] =
    useState<DOMRect | null>(null);
  const [selectedElementTag, setSelectedElementTag] = useState<string>("");
  const [elementStyles, setElementStyles] = useState<
    Record<string, TypographyStyles>
  >({});
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, PendingChange>
  >(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What the element said when editing started, so Esc can put it back. */
  const editStartText = useRef<{ id: string; text: string } | null>(null);

  const prefersReducedMotion = useReducedMotion();
  const currentSiteData = demoSites[currentSite];
  const editableTexts = textsBySite[currentSiteData.id] ?? [];
  const hasUnsavedChanges = pendingChanges.size > 0;

  const { position: toolbarPosition } = useFloatingPosition({
    elementBounds: selectedElementBounds,
    toolbarHeight: 48,
    toolbarWidth: 420,
    offset: 12,
    containerRef,
  });

  useEffect(
    () => () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );

  const flashSuccess = () => {
    setShowSuccessAnimation(true);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(
      () => setShowSuccessAnimation(false),
      1800,
    );
  };

  const clearSelection = () => {
    setSelectedElementId(null);
    setSelectedElementBounds(null);
    setSelectedElementTag("");
    editStartText.current = null;
  };

  const updateCurrentTexts = (
    update: (texts: EditableTextModel[]) => EditableTextModel[],
  ) => {
    setTextsBySite((prev) => ({
      ...prev,
      [currentSiteData.id]: update(prev[currentSiteData.id] ?? []),
    }));
  };

  // --- Site switching ------------------------------------------------------

  const goToSite = (index: number, direction?: number) => {
    if (index === currentSite) return;

    setSlideDirection(direction ?? Math.sign(index - currentSite));
    setCurrentSite(index);

    // Typography tweaks and the per-click box capture are scoped to the site
    // that was on screen; element ids repeat across sites, so carrying them
    // over would apply one site's headline styling to another's.
    setElementStyles({});
    setPendingChanges(new Map());
    setOriginalWidths({});
    setOriginalHeights({});
    setPreservedColors({});
    setPreservedShadows({});
    updateCurrentTexts((texts) =>
      texts.map((item) => ({ ...item, isEditing: false })),
    );
    clearSelection();
  };

  const nextSite = () => goToSite((currentSite + 1) % demoSites.length, 1);
  const prevSite = () =>
    goToSite((currentSite - 1 + demoSites.length) % demoSites.length, -1);

  // --- Editing -------------------------------------------------------------

  /**
   * Selects an element and puts it into edit mode.
   *
   * The read-mode box is measured here, before React swaps in the edit branch,
   * because that measurement is the only thing keeping the element from
   * resizing the moment it is clicked.
   */
  const handleElementActivate = (id: string, element: HTMLElement) => {
    const computed = window.getComputedStyle(element);

    setSelectedElementId(id);
    setSelectedElementBounds(element.getBoundingClientRect());
    setSelectedElementTag(element.tagName.toLowerCase());

    setElementStyles((prev) =>
      prev[id]
        ? prev
        : {
            ...prev,
            [id]: {
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              color: computed.color,
              textAlign: computed.textAlign as TypographyStyles["textAlign"],
              lineHeight: computed.lineHeight,
              letterSpacing: computed.letterSpacing,
            },
          },
    );

    // `getBoundingClientRect()`, not `offsetWidth`/`offsetHeight`: those round
    // to whole pixels, so pinning them to a box that actually measures 200.67px
    // wide made it 201px in edit mode — a third of a pixel of drift that shows
    // up as a shimmer on click.
    const box = element.getBoundingClientRect();
    setOriginalWidths((prev) => ({ ...prev, [id]: box.width }));
    setOriginalHeights((prev) => ({ ...prev, [id]: box.height }));
    setPreservedColors((prev) => ({ ...prev, [id]: computed.color }));
    setPreservedShadows((prev) => ({ ...prev, [id]: "inherit" }));

    // Read the copy back out of the rendered line divs. They are tagged with
    // `data-line` so selection chrome — the tag badge, the underline, the
    // hover pencil — can never leak into the text being edited.
    const rendered = Array.from(
      element.querySelectorAll<HTMLElement>("[data-line]"),
    )
      .map((line) => line.textContent?.trim() ?? "")
      .join("\n");
    const fallback = editableTexts.find((item) => item.id === id)?.text ?? "";
    const fullText = rendered.trim() ? rendered : fallback;

    editStartText.current = { id, text: fullText };
    updateCurrentTexts((texts) =>
      texts.map((item) =>
        item.id === id
          ? { ...item, text: fullText, isEditing: true }
          : { ...item, isEditing: false },
      ),
    );
  };

  const handleTextChange = (id: string, newText: string) => {
    updateCurrentTexts((texts) =>
      texts.map((item) => (item.id === id ? { ...item, text: newText } : item)),
    );
  };

  const handleStylesChange = (styles: Partial<TypographyStyles>) => {
    if (!selectedElementId) return;

    const currentItem = editableTexts.find(
      (item) => item.id === selectedElementId,
    );
    if (!currentItem) return;

    // Functional updater so rapid slider events never read a stale snapshot.
    setElementStyles((prev) => {
      const existingStyles = prev[selectedElementId] ?? DEFAULT_STYLES;
      const mergedStyles: TypographyStyles = { ...existingStyles, ...styles };

      setPendingChanges((prevChanges) => {
        const existingChange = prevChanges.get(selectedElementId);
        const newMap = new Map(prevChanges);
        newMap.set(selectedElementId, {
          original: existingChange?.original ?? currentItem.text,
          current: currentItem.text,
          originalStyles: existingChange?.originalStyles ?? existingStyles,
          currentStyles: mergedStyles,
        });
        return newMap;
      });

      return { ...prev, [selectedElementId]: mergedStyles };
    });
  };

  /** Leave edit mode, keeping whatever was typed. */
  const commitEdit = () => {
    updateCurrentTexts((texts) =>
      texts.map((item) => ({ ...item, isEditing: false })),
    );
    if (selectedElementId) flashSuccess();
    clearSelection();
  };

  /** Leave edit mode, putting the copy and styling back as they were. */
  const cancelEdit = () => {
    const snapshot = editStartText.current;
    const pendingChange = selectedElementId
      ? pendingChanges.get(selectedElementId)
      : undefined;

    updateCurrentTexts((texts) =>
      texts.map((item) =>
        snapshot && item.id === snapshot.id
          ? { ...item, text: snapshot.text, isEditing: false }
          : { ...item, isEditing: false },
      ),
    );

    if (selectedElementId && pendingChange?.originalStyles) {
      setElementStyles((prev) => ({
        ...prev,
        [selectedElementId]: pendingChange.originalStyles!,
      }));
    }

    clearSelection();
  };

  const handleSaveAllChanges = () => {
    setPendingChanges(new Map());
    flashSuccess();
  };

  const handleDiscardAllChanges = () => {
    pendingChanges.forEach((change, id) => {
      updateCurrentTexts((texts) =>
        texts.map((item) =>
          item.id === id ? { ...item, text: change.original } : item,
        ),
      );
      if (change.originalStyles) {
        setElementStyles((prev) => ({ ...prev, [id]: change.originalStyles! }));
      }
    });
    setPendingChanges(new Map());
    clearSelection();
  };

  // Clicking anywhere that is not an editable element or the editor chrome
  // ends the edit rather than stranding an open textarea with no toolbar.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("[data-editable-id]") ||
        target.closest("[data-editor-toolbar]") ||
        target.closest("[data-typography-panel]")
      ) {
        return;
      }
      setTextsBySite((prev) => {
        const texts = prev[currentSiteData.id] ?? [];
        if (!texts.some((item) => item.isEditing)) return prev;
        return {
          ...prev,
          [currentSiteData.id]: texts.map((item) => ({
            ...item,
            isEditing: false,
          })),
        };
      });
      clearSelection();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [currentSiteData.id]);

  // --- Rendering -----------------------------------------------------------

  /**
   * The render callbacks a site layout receives. Built from an explicit `site`
   * rather than from `currentSiteData` so the outgoing slide keeps resolving
   * its own copy and photos while it animates away.
   */
  const buildRenderProps = (site: DemoSite): DemoSiteRenderProps => ({
    text: (id) => {
      const item = (textsBySite[site.id] ?? []).find(
        (candidate) => candidate.id === id,
      );
      if (!item) return null;

      const isSelected = selectedElementId === id;
      return (
        <EditableText
          key={id}
          item={item}
          typographyClasses={site.textStyles[id] ?? site.textStyles.default}
          isSelected={isSelected}
          selectedTag={isSelected ? selectedElementTag : ""}
          customStyles={elementStyles[id]}
          pinnedWidth={originalWidths[id]}
          pinnedHeight={originalHeights[id]}
          preservedColor={preservedColors[id]}
          preservedTextShadow={preservedShadows[id]}
          onSelect={handleElementActivate}
          onChange={handleTextChange}
          onCommit={commitEdit}
          onCancel={cancelEdit}
        />
      );
    },
    image: (slot, options) => {
      const pool = site.images[slot];
      if (!pool || pool.length === 0) return null;

      const key = `${site.id}:${slot}`;
      return (
        <EditableImage
          key={key}
          src={imageSources[key] ?? pool[0]}
          pool={pool}
          alt={options.alt}
          className={options.className}
          wrapperClassName={options.wrapperClassName}
          onReplace={(nextSrc) => {
            setImageSources((prev) => ({ ...prev, [key]: nextSrc }));
            flashSuccess();
          }}
        />
      );
    },
  });

  const SiteLayout = SITE_LAYOUTS[currentSiteData.id];
  const variants = prefersReducedMotion ? fadeVariants : slideVariants;

  return (
    // `data-demo-surface` opts this subtree out of the global border-colour
    // reset — see the note beside it in globals.css.
    <div className="relative" data-demo-surface ref={containerRef}>
      <FloatingEditorToolbar
        position={toolbarPosition}
        styles={
          selectedElementId
            ? (elementStyles[selectedElementId] ?? DEFAULT_STYLES)
            : DEFAULT_STYLES
        }
        onStylesChange={handleStylesChange}
        onSave={commitEdit}
        onDelete={cancelEdit}
        onAIPrompt={() => {
          window.open(
            "/login?redirectedFrom=" + encodeURIComponent(window.location.href),
            "_blank",
            "width=500,height=600",
          );
        }}
        isVisible={
          !!selectedElementId &&
          editableTexts.some(
            (item) => item.id === selectedElementId && item.isEditing,
          )
        }
      />

      <UnsavedChangesBar
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={handleSaveAllChanges}
        onDiscard={handleDiscardAllChanges}
        changeCount={pendingChanges.size}
      />

      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3.5 py-2.5 text-sm font-medium text-emerald-700"
          >
            <CheckCircle className="h-4 w-4" />
            Content updated instantly
          </motion.div>
        )}
      </AnimatePresence>

      {/* Site switcher */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 rounded-xl border border-sky-200 bg-white/70 p-1 backdrop-blur"
          role="tablist"
          aria-label="Demo websites"
        >
          {demoSites.map((site, index) => {
            const Icon = site.icon;
            const isActive = currentSite === index;
            return (
              <button
                key={site.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => goToSite(index)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-sky-50 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {site.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevSite}
            aria-label="Previous website"
            className="rounded-lg border border-sky-200 p-2 text-slate-500 transition-colors duration-200 hover:border-sky-400 hover:bg-sky-50 hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextSite}
            aria-label="Next website"
            className="rounded-lg border border-sky-200 p-2 text-slate-500 transition-colors duration-200 hover:border-sky-400 hover:bg-sky-50 hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* The fake browser */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <BrowserChrome domain={currentSiteData.domain} />

        <div className="relative h-[640px] overflow-hidden md:h-[740px]">
          <AnimatePresence custom={slideDirection} initial={false} mode="wait">
            <motion.div
              key={currentSiteData.id}
              custom={slideDirection}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              className="absolute inset-0 overflow-x-hidden overflow-y-auto"
            >
              {SiteLayout ? (
                <SiteLayout {...buildRenderProps(currentSiteData)} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-600">
        <Sparkles className="h-4 w-4 text-sky-600" />
        Click any text or photograph above to edit it in place
      </p>
    </div>
  );
}
