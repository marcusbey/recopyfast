"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MousePointerClick, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const TRY_RUNTIME_VERSION = "20260924";
export const TRY_RUNTIME_URL =
  `https://www.recopyfa.st/try/rcf-try.js?v=${TRY_RUNTIME_VERSION}` as const;

const SAMPLE_ROOT_SELECTOR = "#rcf-try-sample";

type PreviewWindow = Window & {
  __rcfTryPreview?: { exit: () => void };
};

function discardPendingScript(ref: {
  current: HTMLScriptElement | null;
}): void {
  const script = ref.current;
  if (!script) return;

  // Removing a fetched script node does not guarantee its already-queued code
  // cannot execute. Invalidate the runtime scope first so a late execution
  // fails closed, then detach callbacks so it cannot revive stale UI state.
  script.dataset.rcfTryRoot = `#rcf-try-cancelled-${TRY_RUNTIME_VERSION}`;
  script.onload = null;
  script.onerror = null;
  script.remove();
  ref.current = null;
}

/**
 * React intentionally strips `javascript:` href values during render. This is
 * a fixed, authored bookmarklet rather than user input, so it is assigned to
 * the anchor after mount. Keeping the source in one constant also means the
 * visible installer and the sample cannot drift onto different runtime builds.
 */
function bookmarkletSource(): string {
  return `javascript:(()=>{if(window.__rcfTryPreview||document.getElementById('rcf-try-loader'))return;const s=document.createElement('script');s.id='rcf-try-loader';s.src='${TRY_RUNTIME_URL}';s.onload=()=>s.remove();s.onerror=()=>{s.remove();if(document.getElementById('rcf-try-load-failed'))return;const n=document.createElement('div');n.id='rcf-try-load-failed';n.setAttribute('role','status');n.tabIndex=-1;n.textContent='ReCopyFast could not load here. Open ';const a=document.createElement('a');a.href='https://www.recopyfa.st/try#sample';a.textContent='the live sample';n.append(a);document.body.append(n);n.focus();n.scrollIntoView({block:'center'})};document.head.append(s)})()`;
}

export function TryExperience() {
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const pendingScriptRef = useRef<HTMLScriptElement | null>(null);
  const [sampleKey, setSampleKey] = useState(0);
  const [sampleState, setSampleState] = useState<
    "idle" | "loading" | "active" | "failed"
  >("idle");

  useEffect(() => {
    bookmarkletRef.current?.setAttribute("href", bookmarkletSource());

    return () => {
      discardPendingScript(pendingScriptRef);
      (window as PreviewWindow).__rcfTryPreview?.exit();
    };
  }, []);

  useEffect(() => {
    if (sampleState !== "active") return;

    const timer = window.setInterval(() => {
      if (!(window as PreviewWindow).__rcfTryPreview) {
        setSampleState("idle");
      }
    }, 300);

    return () => window.clearInterval(timer);
  }, [sampleState]);

  const activateSample = () => {
    if (sampleState === "loading") return;

    (window as PreviewWindow).__rcfTryPreview?.exit();
    discardPendingScript(pendingScriptRef);

    const script = document.createElement("script");
    script.src = `/try/rcf-try.js?v=${TRY_RUNTIME_VERSION}`;
    script.dataset.rcfTryRoot = SAMPLE_ROOT_SELECTOR;
    script.onload = () => {
      if (pendingScriptRef.current !== script) return;
      script.remove();
      pendingScriptRef.current = null;
      setSampleState(
        (window as PreviewWindow).__rcfTryPreview ? "active" : "failed",
      );
    };
    script.onerror = () => {
      if (pendingScriptRef.current !== script) return;
      script.remove();
      pendingScriptRef.current = null;
      setSampleState("failed");
    };
    pendingScriptRef.current = script;
    setSampleState("loading");
    document.body.appendChild(script);
  };

  const resetSample = () => {
    discardPendingScript(pendingScriptRef);
    (window as PreviewWindow).__rcfTryPreview?.exit();
    setSampleKey((current) => current + 1);
    setSampleState("idle");
  };

  return (
    <>
      <section id="install" className="px-6 py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-sky-600">
              One-click preview
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Put the preview in your bookmarks bar
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600">
              Drag the button into your bookmarks bar. Open any client page,
              click the bookmark, then click the copy you want to change.
            </p>

            <a
              ref={bookmarkletRef}
              href="#bookmarklet-loading"
              draggable
              aria-label="Drag “Try ReCopyFast” to your bookmarks bar"
              className="pressable mt-8 inline-flex min-h-14 cursor-grab items-center gap-3 rounded-xl bg-slate-900 px-6 py-4 text-base font-semibold text-white shadow-lg transition-[background-color,box-shadow,transform] hover:bg-slate-800 hover:shadow-xl active:cursor-grabbing"
            >
              <MousePointerClick className="h-5 w-5" aria-hidden="true" />
              Try ReCopyFast
            </a>
            <p id="bookmarklet-loading" className="mt-3 text-sm text-slate-500">
              Drag this button instead of clicking it. The preview never uploads
              the page or your edits.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Links in navigation stay safe by default. Hold Alt while clicking
              one if you want to edit its label. Exit stops editing. Refresh the
              page to discard your preview changes.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              [
                "Chrome",
                "Show the bookmarks bar, then drag the button onto it.",
              ],
              [
                "Safari",
                "Show the Favorites bar, then drag the button onto it.",
              ],
              [
                "Firefox",
                "Show the Bookmarks Toolbar, then drag the button onto it.",
              ],
              [
                "Mobile",
                "On mobile, use desktop. Mobile browsers do not offer a reliable bookmarklet flow.",
              ],
            ].map(([title, body]) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="sample"
        className="border-y border-slate-200 bg-white px-6 py-20 sm:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-sky-600">
                Try it now
              </p>
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Try it here first
              </h2>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
                Some sites block the ReCopyFast script origin or its single
                inline style element with a strict Content Security Policy. This
                sample gives you the same editing flow without leaving
                ReCopyFast.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={activateSample}
                disabled={sampleState === "loading"}
                className="bg-sky-600 text-white hover:bg-sky-700"
              >
                {sampleState === "loading"
                  ? "Loading preview…"
                  : "Edit this sample"}
              </Button>
              <Button type="button" variant="outline" onClick={resetSample}>
                <RefreshCw aria-hidden="true" />
                Reset
              </Button>
            </div>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            To keep the preview offline after it loads, image replacement
            accepts embedded raster data URLs only. It does not fetch remote
            image URLs.
          </p>

          <div
            aria-live="polite"
            className="mt-4 min-h-6 text-sm text-slate-600"
          >
            {sampleState === "active" &&
              "Preview active. Hover and click the sample copy below."}
            {sampleState === "failed" &&
              "The preview could not load. Reload this page and try again."}
          </div>

          <div
            key={sampleKey}
            id="rcf-try-sample"
            data-testid="try-live-sample"
            className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-[#f6f0e7] shadow-xl"
          >
            <nav className="flex items-center justify-between border-b border-[#ded4c6] px-6 py-4 text-[#32291f] sm:px-10">
              <a href="#sample" className="font-semibold tracking-wide">
                NORTHLINE COFFEE
              </a>
              <a href="#sample-menu" className="text-sm font-medium">
                Menu
              </a>
            </nav>
            <div className="grid items-center gap-8 px-6 py-10 sm:px-10 md:grid-cols-2 md:py-14">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#806a52]">
                  Thoughtful coffee, every morning
                </p>
                <h3 className="mt-4 font-display text-4xl font-bold leading-tight text-[#2a2119] sm:text-5xl">
                  Make good coffee feel easy
                </h3>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-[#665748]">
                  Seasonal beans, clear brewing notes and dependable delivery
                  for teams that care about the small details.
                </p>
                <button
                  type="button"
                  className="mt-7 rounded-lg bg-[#2a2119] px-5 py-3 text-sm font-semibold text-white"
                >
                  Explore this month&apos;s coffee
                </button>
              </div>
              <Image
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='680' viewBox='0 0 900 680'%3E%3Crect width='900' height='680' fill='%23d8c4aa'/%3E%3Ccircle cx='450' cy='330' r='190' fill='%23f7efe4'/%3E%3Ccircle cx='450' cy='330' r='145' fill='%23704b32'/%3E%3Cpath d='M580 260c120 0 120 150 0 150' fill='none' stroke='%23f7efe4' stroke-width='42'/%3E%3C/svg%3E"
                alt="A warm cup of coffee"
                width={900}
                height={680}
                unoptimized
                className="aspect-[4/3] h-auto w-full rounded-xl object-cover"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
