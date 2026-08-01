import { redirect } from "next/navigation";

/**
 * `/settings` is advertised in two places we cannot retarget away from:
 * the account dropdown in `UserMenu`, and the `protectedRoutes` list in
 * `src/middleware.ts`. The real settings UI lives at `/dashboard/settings`,
 * so signed-in users were passing the middleware auth gate and then hitting
 * a 404. Redirecting keeps every existing link and bookmark working instead
 * of leaving `/settings` as a dangling protected route.
 */
export default function SettingsPage() {
  redirect("/dashboard/settings");
}
