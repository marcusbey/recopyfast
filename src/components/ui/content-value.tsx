"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff, ImageIcon, Link2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Renders one content element's value the way it actually appears on the
 * customer's site: image elements render as images, text renders as text.
 *
 * The widget stores image elements as either a remote URL or — for content
 * captured before the upload pipeline existed — a base64 data URI that can run
 * to several megabytes. Printing that string into a paragraph froze the content
 * list, so data URIs are summarised rather than echoed, and every image sits in
 * a fixed-height frame so the list never reflows as images resolve.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const DATA_URI = /^data:image\//i;

export type ContentKind = "text" | "image" | "empty";

/**
 * Decides how a stored value should be presented. `metadataType` is the
 * widget's own classification (`getElementEditType`) and wins when present,
 * because an <img> whose src has no file extension is still an image.
 */
export function classifyContent(
  value: string | undefined,
  metadataType?: string,
): ContentKind {
  const trimmed = value?.trim();
  if (!trimmed) return "empty";
  if (metadataType === "image") return "image";
  if (DATA_URI.test(trimmed)) return "image";
  if (/^https?:\/\//i.test(trimmed) && IMAGE_EXTENSIONS.test(trimmed)) {
    return "image";
  }
  return "text";
}

function formatBytes(byteCount: number): string {
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1024 * 1024) return `${Math.round(byteCount / 1024)} KB`;
  return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
}

/** Approximate decoded size of a base64 data URI without decoding it. */
function dataUriByteLength(value: string): number {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex === -1 ? value : value.slice(commaIndex + 1);
  return Math.floor((payload.length * 3) / 4);
}

interface ContentImageProps {
  src: string;
  /** Used as the accessible name; falls back to the element id. */
  alt: string;
  className?: string;
}

function ContentImage({ src, alt, className }: ContentImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isDataUri = DATA_URI.test(src);

  if (failed) {
    return (
      <div
        className={cn(
          "flex h-32 max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-tone-danger-border bg-tone-danger-surface px-4 text-center",
          className,
        )}
      >
        <ImageOff
          className="h-5 w-5 text-tone-danger-text"
          aria-hidden="true"
        />
        <p className="text-xs font-medium text-tone-danger-text">
          Image failed to load
        </p>
        <p className="max-w-full truncate font-mono text-[11px] text-muted-foreground">
          {src}
        </p>
      </div>
    );
  }

  return (
    <figure className={cn("max-w-sm space-y-1.5", className)}>
      {/* Fixed height + object-contain keeps rows a stable height whatever the
          source aspect ratio, so the list does not jump as images decode. */}
      <div className="relative h-32 w-full overflow-hidden rounded-lg border border-border bg-surface-2">
        {!loaded && (
          <div className="skeleton absolute inset-0" aria-hidden="true" />
        )}
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 480px"
          className="object-contain"
          // Sources are arbitrary customer URLs and legacy data URIs, neither of
          // which the Next image optimizer can be configured for ahead of time.
          unoptimized
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      </div>
      <figcaption className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {isDataUri ? (
          <>
            <ImageIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              Embedded image ({formatBytes(dataUriByteLength(src))}) — re-upload
              to store it as a file
            </span>
          </>
        ) : (
          <>
            <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono">{src}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

interface ContentValueProps {
  value: string | undefined;
  /** `metadata.type` from the content element. */
  metadataType?: string;
  /** Accessible name for image content. */
  label: string;
  /** When false, long text is clamped with CSS rather than cut from the string. */
  expanded?: boolean;
  className?: string;
}

export function ContentValue({
  value,
  metadataType,
  label,
  expanded = false,
  className,
}: ContentValueProps) {
  const kind = classifyContent(value, metadataType);

  if (kind === "empty") {
    return (
      <p className={cn("text-sm italic text-muted-foreground", className)}>
        Empty
      </p>
    );
  }

  if (kind === "image") {
    return (
      <ContentImage src={value!.trim()} alt={label} className={className} />
    );
  }

  // Clamping is presentational only — the full string stays in the DOM, so it
  // is still selectable, searchable and copyable while collapsed.
  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words text-sm",
        !expanded && "line-clamp-3",
        className,
      )}
    >
      {value}
    </p>
  );
}
