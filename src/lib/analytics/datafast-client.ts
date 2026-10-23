import { isDataFastEnabled } from "./datafast";
import {
  dataFastToolGoal,
  sanitizeGoalParams,
  type DataFastClientGoal,
  type DataFastGoalParams,
} from "./datafast-goals";

/**
 * Browser-side DataFast goals (ADR 074).
 *
 * WHY NOT THE QUEUE SNIPPET. DataFast recommends an inline
 * `<script id="datafast-queue">` so goals fired before its script loads are
 * queued. An inline script needs a hash in the static CSP and the nonce on the
 * app surface (ADR 059) — two policies to keep in step for four lines. This
 * helper installs the same queue on first use instead: when `window.datafast`
 * is absent it becomes a function that pushes its arguments onto
 * `window.datafast.q`, which is exactly what the snippet defines and what the
 * script drains once it loads. No inline script, no CSP change.
 *
 * Off (`NEXT_PUBLIC_DATAFAST_DISABLED=true`, the CI builds) it does nothing at
 * all — not even the queue — so a disabled build leaves no trace on `window`.
 * Every param goes through `sanitizeGoalParams`: categorical values only.
 */

type DataFastQueue = ((...args: unknown[]) => void) & { q?: unknown[][] };
type DataFastWindow = Window & { datafast?: DataFastQueue };

function dataFastFunction(target: DataFastWindow): DataFastQueue {
  if (typeof target.datafast === "function") return target.datafast;
  const queue: DataFastQueue = (...args: unknown[]) => {
    (queue.q ??= []).push(args);
  };
  target.datafast = queue;
  return queue;
}

type ParamsArg<N extends DataFastClientGoal> =
  DataFastGoalParams[N] extends Record<string, never>
    ? []
    : [params: DataFastGoalParams[N]];

/** Send (or queue) one goal. Returns whether it was handed to DataFast. */
export function trackGoal<N extends DataFastClientGoal>(
  name: N,
  ...[params]: ParamsArg<N>
): boolean {
  if (typeof window === "undefined" || !isDataFastEnabled()) return false;
  try {
    const send = dataFastFunction(window as DataFastWindow);
    const clean = sanitizeGoalParams(params);
    if (Object.keys(clean).length > 0) send(name, clean);
    else send(name);
    return true;
  } catch {
    // Analytics never breaks the action it measures.
    return false;
  }
}

/** The goal a successful run of the /tools entry at `slug` sends. */
export function trackToolGoal(slug: string): boolean {
  const goal = dataFastToolGoal(slug);
  return goal.name === "tool_run"
    ? trackGoal(goal.name, goal.params)
    : trackGoal(goal.name);
}
