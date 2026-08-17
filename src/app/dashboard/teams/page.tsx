import { redirect } from "next/navigation";

/**
 * Teams with org roles is in the graveyard (`docs/prd.md`, "Explicitly NOT
 * replicated"): the permission model is an owner plus editors invited by email
 * from a site's own Share panel, and nothing else. `/api/teams/*` stays
 * deployed and stays answering — frozen means unexposed, not deleted, so an
 * agency that eventually needs real teams is a re-wiring job. What is retired
 * is the customer-facing surface.
 *
 * This file used to be 538 lines of *working* team management — list teams,
 * invite by email with a role, remove members — and hiding the sidebar entry
 * would not have retired any of it. Nothing gated this URL: `src/middleware.ts`
 * applies only its generic auth and entitlement checks here, so a bookmark, an
 * old email link or a typed address reached the full console. The page itself
 * had to go.
 *
 * It redirects rather than 404s because every one of those links still exists
 * in someone's history. `?notice=teams-moved` is what stops the redirect from
 * being silent: `/dashboard/sites` reads it and says why the user landed on a
 * list of sites after asking for teams.
 */
export default function TeamsPage() {
  redirect("/dashboard/sites?notice=teams-moved");
}
