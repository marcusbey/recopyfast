"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, UIEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { CheckCircle, Sparkles } from "lucide-react";
import { FloatingEditorToolbar, UnsavedChangesBar } from "@/components/editor";
import { useFloatingPosition } from "@/lib/hooks/useFloatingPosition";
import type { PendingChange, TypographyStyles } from "@/types/editor";
import BellaVistaSite from "./demo/BellaVistaSite";
import BrowserWindow from "./demo/BrowserWindow";
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
 * The attract loop: what the demo does while nobody has touched it yet.
 *
 * Two things about this demo are invisible at rest. That there are three sites
 * behind the tabs, and that the copy inside them is clickable — both were only
 * discoverable by hovering something you had no reason to hover. So the demo
 * shows you: it moves through the tabs on its own, and it draws the hover ring
 * on one on-screen string at a time, which is the same chrome your pointer
 * would have produced.
 *
 * It stops for good at the first interaction — a tab, a toolbar button, a click
 * on any text. Once somebody is driving, a demo that keeps moving on its own is
 * no longer a hint, it is a fight over the caret. It also does not run under
 * `prefers-reduced-motion`, and only runs while the demo is actually on screen.
 */
const TAB_DWELL_MS = 6000;
const HINT_INTERVAL_MS = 2600;
const HINT_VISIBLE_MS = 1500;
/** Demo-scroll progress that counts as "the visitor is now reading this". */
const SCROLL_ENGAGED_AT = 0.01;

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

interface InteractiveHeroProps {
  /**
   * 0→1 progress from the sticky wrapper's scroll track. When provided, page
   * scroll drives the demo site's own scroll position — the fake browser stays
   * pinned while the reader scrolls through the demo page, and the landing
   * page resumes once the demo bottoms out. Subscribed to directly rather than
   * consumed as React state: it changes every frame while scrolling.
   */
  demoScrollProgress?: MotionValue<number>;
  /** Fill the parent's height instead of the fixed marketing-page height. */
  fillHeight?: boolean;
}

export default function InteractiveHero({
  demoScrollProgress,
  fillHeight = false,
}: InteractiveHeroProps) {
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

  /** Attract-loop state. `hasInteracted` is one-way: nothing turns it back on. */
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isOnScreen, setIsOnScreen] = useState(false);
  const [hintedId, setHintedId] = useState<string | null>(null);

  /** The fixed overlays are portalled, and there is no `document` to portal
      into until this component has mounted on the client. */
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const containerRef = useRef<HTMLDivElement>(null);
  const hintCursor = useRef(0);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What the element said when editing started, so Esc can put it back. */
  const editStartText = useRef<{ id: string; text: string } | null>(null);

  /** The active site's scrollable viewport, re-bound on every site switch. */
  const siteScrollRef = useRef<HTMLDivElement | null>(null);
  /** Last progress seen, so a freshly mounted site starts at the right depth. */
  const latestDemoProgress = useRef(0);
  /** The last `scrollTop` this component wrote, so its own writes can be told
      apart from the visitor's — both arrive as the same scroll event. */
  const appliedScrollTop = useRef<number | null>(null);

  const applyDemoScroll = useCallback((progressValue: number) => {
    const el = siteScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll > 0) {
      appliedScrollTop.current = progressValue * maxScroll;
      el.scrollTop = appliedScrollTop.current;
    }
  }, []);

  useEffect(() => {
    if (!demoScrollProgress) return;
    latestDemoProgress.current = demoScrollProgress.get();
    applyDemoScroll(latestDemoProgress.current);
    return demoScrollProgress.on("change", (value) => {
      latestDemoProgress.current = value;
      applyDemoScroll(value);
      /* Scrolling INTO the demo counts as engagement. Past this point the
         visitor is reading the site the attract loop was there to advertise,
         and cycling the tabs out from under them — or ringing a string they
         did not choose — interrupts exactly the thing they came to look at.
         The threshold only has to clear the resting value; the loop ends on
         the first real movement of the track. */
      if (value > SCROLL_ENGAGED_AT) setHasInteracted(true);
    });
  }, [demoScrollProgress, applyDemoScroll]);

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

  const advanceSite = () => goToSite((currentSite + 1) % demoSites.length, 1);

  /* The user-driven entry points. They differ from `advanceSite` in one way
     that matters: reaching the demo through any of them ends the attract loop. */
  const nextSite = () => {
    setHasInteracted(true);
    advanceSite();
  };
  const prevSite = () => {
    setHasInteracted(true);
    goToSite((currentSite - 1 + demoSites.length) % demoSites.length, -1);
  };

  const goToSiteId = (id: string) => {
    setHasInteracted(true);
    const index = demoSites.findIndex((site) => site.id === id);
    if (index >= 0) goToSite(index);
  };

  /**
   * What the browser's reload button means here: put this site back the way it
   * shipped. Scoped to the active site — a visitor who edited the restaurant,
   * moved to the bakery and reloaded expects to have reset the bakery.
   */
  const reloadCurrentSite = () => {
    setHasInteracted(true);
    const site = currentSiteData;

    setTextsBySite((prev) => ({
      ...prev,
      [site.id]: site.editableTexts.map((item) => ({
        ...item,
        text: item.originalText,
        isEditing: false,
      })),
    }));
    setImageSources((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => !key.startsWith(`${site.id}:`)),
      ),
    );

    setElementStyles({});
    setPendingChanges(new Map());
    setOriginalWidths({});
    setOriginalHeights({});
    setPreservedColors({});
    setPreservedShadows({});
    clearSelection();
  };

  // --- Editing -------------------------------------------------------------

  /**
   * Selects an element and puts it into edit mode.
   *
   * The read-mode box is measured here, before React swaps in the edit branch,
   * because that measurement is the only thing keeping the element from
   * resizing the moment it is clicked.
   */
  const handleElementActivate = (id: string, element: HTMLElement) => {
    setHasInteracted(true);
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

  // --- The attract loop ----------------------------------------------------

  /* Off screen it must not run at all: on the landing page this component sits
     inside a 320vh track, so without this it would be cycling tabs and painting
     rings to an empty room for most of the page. */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsOnScreen(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* The tab cycle reads its action through a ref so the interval does not have
     to be rebuilt — and the dwell restarted — on every unrelated render. */
  const advanceSiteRef = useRef(advanceSite);
  useEffect(() => {
    advanceSiteRef.current = advanceSite;
  });

  /**
   * The other way somebody takes the wheel: they just scroll, point at, or tab
   * into the demo without pressing any of the controls above.
   *
   * The scroll-progress subscription only exists where a progress MotionValue
   * is supplied, which is the landing page. On /demo the demo site's own
   * `overflow-y-auto` viewport is the only thing that moves, nothing was
   * listening to it, and the tabs went on cycling every six seconds under
   * somebody who was mid-read. These run in the capture phase because `scroll`
   * does not bubble, so a listener on this container would never see it.
   */
  const handleSurfaceScroll = (event: UIEvent<HTMLDivElement>) => {
    /* `applyDemoScroll` writes `scrollTop` itself and that write raises a
       scroll event of its own. Only a position this component did not just set
       is the visitor; on the landing page their engagement is already measured
       by SCROLL_ENGAGED_AT against the track. */
    const target = event.target as HTMLElement;
    if (
      appliedScrollTop.current !== null &&
      Math.abs(target.scrollTop - appliedScrollTop.current) < 1
    ) {
      return;
    }
    setHasInteracted(true);
  };

  const handleSurfaceEngage = () => setHasInteracted(true);

  const isAttracting = !hasInteracted && !prefersReducedMotion && isOnScreen;

  useEffect(() => {
    if (!isAttracting) return;
    const timer = setInterval(() => advanceSiteRef.current(), TAB_DWELL_MS);
    return () => clearInterval(timer);
  }, [isAttracting]);

  /* The ring walks the strings that are ACTUALLY in the demo's viewport, which
     is why it is measured rather than taken from the site's copy list: the demo
     scrolls under page scroll, so which strings are visible changes constantly
     and a fixed order would spend most of its time pointing off screen. */
  useEffect(() => {
    if (!isAttracting) {
      setHintedId(null);
      return;
    }

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const scroller = siteScrollRef.current;
      if (!scroller) return;

      const view = scroller.getBoundingClientRect();
      const onScreen = Array.from(
        scroller.querySelectorAll<HTMLElement>("[data-editable-id]"),
      ).filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.height === 0) return false;
        /* Mostly visible, not strictly contained. Requiring containment threw
           away every candidate whenever the demo was mid-scroll, and the ring
           went dark for whole beats at a time. */
        const shown =
          Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top);
        return shown >= box.height * 0.6;
      });
      if (onScreen.length === 0) return;

      const pick = onScreen[hintCursor.current % onScreen.length];
      hintCursor.current += 1;
      setHintedId(pick.dataset.editableId ?? null);

      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setHintedId(null), HINT_VISIBLE_MS);
    };

    const timer = setInterval(tick, HINT_INTERVAL_MS);
    tick();

    return () => {
      clearInterval(timer);
      if (hideTimer) clearTimeout(hideTimer);
      setHintedId(null);
    };
  }, [isAttracting, currentSiteData.id]);

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
          /* Element ids repeat across sites, so the hint is scoped to the site
             on screen — otherwise the outgoing site lights up mid-slide. */
          isHinted={site.id === currentSiteData.id && hintedId === id}
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
            setHasInteracted(true);
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
    <div
      className={`relative ${fillHeight ? "flex h-full min-h-0 flex-col" : ""}`}
      data-demo-surface
      ref={containerRef}
      onScrollCapture={handleSurfaceScroll}
      onPointerDownCapture={handleSurfaceEngage}
      onFocusCapture={handleSurfaceEngage}
    >
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

      {/* Portalled to the body, like the toolbar above it. On the landing page
          this component sits inside a transformed wrapper (HeroDemo's scale/y),
          and a transformed ancestor becomes the containing block for its
          `position: fixed` descendants — the toast would stop being fixed to
          the viewport and ride the window off the top of the screen instead. */}
      {isMounted &&
        createPortal(
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
                {/* Was "Content updated instantly", which is the same real-time
                    claim F-12 removed from ValueProposition and HowItWorks —
                    and this component renders on the landing page, so it undid
                    the fix two sections further down. Editing saves a draft; a
                    separate publish is what reaches visitors. */}
                Saved — ready to publish
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* The fake browser. Its tabs are the site switcher — see BrowserWindow. */}
      <BrowserWindow
        tabs={demoSites}
        activeId={currentSiteData.id}
        onSelect={goToSiteId}
        onBack={prevSite}
        onForward={nextSite}
        onReload={reloadCurrentSite}
        fillHeight={fillHeight}
        status={
          <p className="flex items-center justify-center gap-2 text-sm text-slate-600">
            <Sparkles className="h-4 w-4 text-sky-600" />
            Click any text or photograph to edit it in place
          </p>
        }
      >
        <div
          className={`relative overflow-hidden ${
            fillHeight ? "min-h-0 flex-1" : "h-[640px] md:h-[740px]"
          }`}
        >
          <AnimatePresence custom={slideDirection} initial={false} mode="wait">
            <motion.div
              key={currentSiteData.id}
              ref={(node: HTMLDivElement | null) => {
                siteScrollRef.current = node;
                // A newly mounted site (site switch mid-track) starts at the
                // depth the page scroll says it should be, not at its top.
                if (node && demoScrollProgress) {
                  applyDemoScroll(latestDemoProgress.current);
                }
              }}
              custom={slideDirection}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              data-demo-scroller
              /* One owner of `scrollTop` at a time. Where page scroll drives
                 the demo, this viewport must not also be a scroller the finger
                 can drag: a touch swipe used to scroll it natively AND chain to
                 the page, whose progress was then written straight back over
                 the position the swipe had just reached, so the demo snapped
                 backwards mid-gesture. `overflow: hidden` still scrolls
                 programmatically, so `applyDemoScroll` is unaffected. Without a
                 progress value — /demo — the reader owns it and it scrolls. */
              className={`absolute inset-0 overflow-x-hidden ${
                demoScrollProgress ? "overflow-y-hidden" : "overflow-y-auto"
              }`}
            >
              {SiteLayout ? (
                <SiteLayout {...buildRenderProps(currentSiteData)} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </BrowserWindow>
    </div>
  );
}
