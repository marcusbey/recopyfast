/**
 * Process-local mutex keyed by user id.
 *
 * Two overlapping requests in the same isolate must not both pass a
 * check-then-act. Serverless concurrency across isolates is handled by a
 * unique constraint at the database, not here.
 */
const tails = new Map<string, Promise<void>>();

export async function withUserLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(
    userId,
    previous.then(() => current),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
