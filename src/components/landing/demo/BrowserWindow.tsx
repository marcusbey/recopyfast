"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronLeft, ChevronRight, Lock, RotateCw } from "lucide-react";

export interface BrowserTab {
  id: string;
  /** Shown on the tab. */
  name: string;
  /** Shown in the address bar when this tab is active. */
  domain: string;
  icon: ComponentType<{ className?: string }>;
}

interface BrowserWindowProps {
  tabs: readonly BrowserTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Address-bar back/forward. Wired to the previous/next demo site. */
  onBack: () => void;
  onForward: () => void;
  /** Reload. Puts the active site back to the copy and photos it shipped with. */
  onReload: () => void;
  /** Fill the parent's height instead of sizing to the content. */
  fillHeight?: boolean;
  /**
   * Status strip along the window's bottom edge. Inside the frame on purpose:
   * anything hung underneath the window is left floating over whatever the
   * window is sitting on once it starts moving.
   */
  status?: ReactNode;
  children: ReactNode;
}

/**
 * A whole browser window around the demo, rather than a strip above it.
 *
 * The frame replaced `BrowserChrome` when the demo moved into the hero. Up
 * there it is the first object on the page, floating over the sky with nothing
 * to sit against, and a bare address bar read as a toolbar belonging to
 * ReCopyFast. A window with a title bar, tabs and a shadow reads as somebody
 * else's site being edited — which is the whole claim.
 *
 * The three demo sites ARE the tabs. That folds the old pill switcher into the
 * chrome instead of stacking a second row of controls on top of it, and it is
 * how a visitor already expects to move between sites.
 *
 * WHAT IS INERT AND WHY. The traffic lights are ornament — they always were,
 * hence no colour on them. Everything that looks pressable, is: tabs switch
 * sites, back/forward step through them, reload restores the active site. There
 * is deliberately no close (×) or new-tab (+): a control that looks like a
 * control and does nothing is worse than an absent one, and the lights get away
 * with it only because nobody reads three grey dots as a button.
 */
export default function BrowserWindow({
  tabs,
  activeId,
  onSelect,
  onBack,
  onForward,
  onReload,
  fillHeight = false,
  status,
  children,
}: BrowserWindowProps) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_28px_70px_-24px_rgba(15,23,42,0.45)] ${
        fillHeight ? "flex min-h-0 flex-1 flex-col" : ""
      }`}
    >
      {/* Title bar — lights, then the sites as tabs. */}
      <div className="flex items-end gap-3 border-b border-slate-200 bg-slate-100 px-3 pt-2.5">
        <div
          aria-hidden="true"
          className="mb-2 flex shrink-0 items-center gap-1.5"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </div>

        <div
          role="tablist"
          aria-label="Demo websites"
          className="flex min-w-0 items-end gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(tab.id)}
                /* -mb-px so the active tab's white face swallows the title
                   bar's bottom hairline and joins the toolbar below it. */
                className={`-mb-px flex shrink-0 items-center gap-2 rounded-t-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                  isActive
                    ? "border-x border-t border-slate-200 bg-white text-slate-900"
                    : "border-x border-t border-transparent text-slate-500 hover:bg-white/60 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar — navigation, address, and the one badge that is ours. */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:gap-3">
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Previous website"
            className="rounded-md p-1.5 text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onForward}
            aria-label="Next website"
            className="rounded-md p-1.5 text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onReload}
            aria-label="Reload this site and undo the demo edits"
            className="rounded-md p-1.5 text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
          <Lock className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="block truncate font-mono text-[11px] text-slate-500">
            <span className="text-slate-400">https://</span>
            {activeTab.domain}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 pr-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.16em] text-slate-500 uppercase sm:inline">
            ReCopyFast live
          </span>
        </div>
      </div>

      {children}

      {status ? (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          {status}
        </div>
      ) : null}
    </div>
  );
}
