"use client";

interface BrowserChromeProps {
  domain: string;
}

/**
 * The "this is a real website" frame.
 *
 * Restyled but not removed: the framing is what tells a visitor the thing they
 * are about to click is somebody's live site, not a ReCopyFast screen. Kept
 * quiet on purpose — hairlines and greys, no traffic-light candy, no shadow —
 * so it never competes with the three site designs it holds.
 */
export default function BrowserChrome({ domain }: BrowserChromeProps) {
  return (
    <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
      </div>

      <div className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5">
        <span className="block truncate font-mono text-[11px] text-slate-500">
          <span className="text-slate-400">https://</span>
          {domain}
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
  );
}
