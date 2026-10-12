import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ToolEntry } from "@/lib/tools/catalogue";
import { toolPath } from "@/lib/tools/catalogue";

/** One tool on the /tools hub (s96). Marketing to marketing, so a `Link`. */
export function ToolCard({ tool }: { tool: ToolEntry }) {
  return (
    <article className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-8">
      <h2 className="font-display text-2xl font-bold text-slate-900">
        {tool.name}
      </h2>
      <p className="mt-3 leading-relaxed text-slate-600">{tool.description}</p>
      <Link
        className="mt-6 inline-flex items-center gap-2 font-semibold text-sky-700 hover:text-sky-800"
        href={toolPath(tool.slug)}
      >
        Open the {tool.name}
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </article>
  );
}
