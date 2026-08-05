export default function Loading() {
  return (
    <div
      className="min-h-screen bg-background px-6 py-12"
      role="status"
      aria-label="Loading"
    >
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="skeleton h-8 w-1/3" />
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-64 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
