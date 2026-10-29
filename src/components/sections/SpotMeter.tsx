import type { CSSProperties } from "react";
import { spotMeterCells, type SpotMeterCell } from "./spot-meter";

/**
 * One cell per capped spot: sold, the one a buyer would get next, the rest
 * (s124). Marketing surface only, drawn once on the lifetime Agency card.
 *
 * Pass a count that went through `parseSpotAvailability` — the meter creates
 * `limit` DOM nodes and does not re-check it.
 *
 * Deliberately static. framer-motion's `useInView` never fires under Jest
 * (jest.setup.js mocks IntersectionObserver as a no-op), and the section's
 * other blocks already fade in; an animated fill would also make the count
 * read as moving when it is a snapshot of completed sales.
 */

const CELL_CLASS: Record<SpotMeterCell, string> = {
  taken: "bg-slate-500/45",
  next: "bg-teal-700",
  left: "bg-teal-700/20",
};

// The meter lives in the lifetime card's right column, which is `min-w-56`
// (about 224px) at md and up and full width only when the card stacks. 50
// cells in one row there are about 2.5px wide each, so a long meter wraps to
// rows of 25 at every breakpoint, not only on phones. An earlier s124 draft
// went back to one row from `sm` up; review dropped it for that reason.
// Short meters never need to wrap.
const WRAP_COLUMNS = 25;

export default function SpotMeter({
  limit,
  remaining,
  label,
}: {
  limit: number;
  remaining: number;
  label: string;
}) {
  const columns =
    limit > WRAP_COLUMNS
      ? "grid-cols-[repeat(25,minmax(0,1fr))]"
      : "grid-cols-[repeat(var(--spot-meter-columns),minmax(0,1fr))]";

  return (
    <div
      role="img"
      aria-label={label}
      className={`grid gap-0.5 ${columns}`}
      style={{ "--spot-meter-columns": String(limit) } as CSSProperties}
    >
      {spotMeterCells(limit, remaining).map((state, index) => (
        <span
          // Positions never reorder: cell N is always spot N.
          key={index}
          aria-hidden="true"
          data-state={state}
          className={`h-[18px] rounded-[1px] ${CELL_CLASS[state]}`}
        />
      ))}
    </div>
  );
}
