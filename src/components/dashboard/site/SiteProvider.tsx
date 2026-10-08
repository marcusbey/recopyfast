"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { AlertCircle, Globe } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteStatus } from "@/components/ui/status-badge";
import { buildEmbedScript } from "@/lib/sites/embed-script";

/**
 * One site record, shared by every page under `/dashboard/sites/[siteId]`
 * (ADR 052).
 *
 * An App Router layout cannot hand props to its pages, and the header, the
 * Overview, Install, People & access and Settings all need the same site. The
 * record also carries install credentials (`siteToken`, `embedScript`) that
 * `GET /api/sites` mints per request for admins only. Two copies of them can
 * disagree after "Regenerate snippet" revokes the old token, which is exactly
 * what the old detail view kept in one state object to prevent. So the site
 * lives here, once, and nowhere else.
 *
 * This is the second React Context in the app (AGENTS.md § React asks for a
 * reason): the reason is that a layout cannot pass data to its pages and the
 * credentials must exist exactly once. It is scoped to this route subtree and
 * mounted nowhere else.
 *
 * The provider renders its own loading, error and not-found states, each
 * through `PageShell`, so a page never renders without a site.
 */

export interface SiteStats {
  edits_count?: number;
  views?: number;
  content_elements_count?: number;
  last_activity?: string | null;
}

/** One entry of `GET /api/sites`. */
export interface SiteRecord {
  id: string;
  domain: string;
  name: string;
  created_at: string;
  updated_at: string;
  status?: SiteStatus;
  live_at?: string | null;
  last_reported_at?: string | null;
  last_mismatch_domain?: string | null;
  last_mismatch_at?: string | null;
  stats?: SiteStats;
  /** Present for admins only: the route's install credentials. */
  siteToken?: string;
  embedScript?: string;
}

/** The install credentials every consumer must read, and only these. */
export interface SiteCredentials {
  siteToken?: string;
  embedScript?: string;
}

export interface RegenerationState {
  isPending: boolean;
  /** Why the last regeneration failed; the current credentials still stand. */
  error: string | null;
  /** A regeneration succeeded on this visit: say so where the snippet is. */
  hasSucceeded: boolean;
}

export interface SiteContextValue {
  site: SiteRecord;
  /**
   * True exactly when the response carried a site token. That is the route's
   * own admin test: `GET /api/sites` mints install credentials only for an
   * `admin` row in `site_permissions` (`canInstall` in
   * src/app/api/sites/route.ts), and returns no role field to read instead.
   */
  isAdmin: boolean;
  /** Re-reads `GET /api/sites` without taking the page down. */
  refetch: () => Promise<void>;
  /**
   * The snippet and token to show. Never read `site.siteToken` or
   * `site.embedScript` to display them: after a rotation the record is stale
   * until the next fetch, and for one render after a site change it is the
   * wrong site's. These are the guarded values.
   */
  credentials: SiteCredentials;
  /**
   * Rotates the site token (`POST /api/sites/<id>/regenerate-snippet`).
   * Resolves `true` once the new credentials are the ones displayed.
   */
  regenerateSnippet: () => Promise<boolean>;
  regeneration: RegenerationState;
  clearRegenerationError: () => void;
}

export const SiteContext = createContext<SiteContextValue | null>(null);

export function useSiteContext(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) {
    throw new Error(
      "useSiteContext must be used inside <SiteProvider>: every site page reads its site from the provider, never from props.",
    );
  }
  return value;
}

/**
 * How often an open `awaiting-install` site re-checks itself.
 *
 * AC 3 of s02 gives this ten seconds; five leaves room for the request itself,
 * so the owner who pasted the snippet in another tab sees the status turn over
 * inside the promise rather than exactly on it.
 */
const INSTALL_POLL_INTERVAL_MS = 5000;

const LOAD_ERROR = "Could not load your sites.";

async function readLoadError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown } | null)?.error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Non-JSON body: the status-qualified message below.
  }
  return `${LOAD_ERROR} (${response.status})`;
}

interface SiteProviderProps {
  siteId: string;
  children: React.ReactNode;
}

export function SiteProvider({ siteId, children }: SiteProviderProps) {
  const [sites, setSites] = useState<SiteRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write: the poll and a refetch after a
  // rotation can overlap, and an older answer must not land last.
  const requestRef = useRef(0);

  const refetch = useCallback(async () => {
    const request = ++requestRef.current;
    setError(null);
    try {
      const response = await fetch("/api/sites");
      if (!response.ok) throw new Error(await readLoadError(response));
      const body: { sites?: unknown } = await response.json();
      if (request !== requestRef.current) return;
      setSites(Array.isArray(body.sites) ? (body.sites as SiteRecord[]) : []);
    } catch (caught) {
      if (request !== requestRef.current) return;
      console.error("Failed to load the site:", caught);
      // A failed refresh behind a page that already has its site keeps that
      // page: the poll must not tear down the Install page on one dropped
      // request. Without a site yet, this is the page's error state.
      setError(caught instanceof Error ? caught.message : LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      // Leaving the site: whatever is still in flight answers nobody.
      requestRef.current += 1;
    };
  }, [refetch]);

  const site = sites?.find((candidate) => candidate.id === siteId) ?? null;
  const isAwaitingInstall = site?.status === "awaiting-install";

  /**
   * The status turns over by itself while the owner watches it.
   *
   * The flip is a server-side event: the embed script's first authorized
   * report writes `sites.status`, and nothing pushes that to an open tab. The
   * moment this exists for is the owner pasting the snippet in another tab and
   * coming back — telling them to reload is not an answer, because they cannot
   * know whether anything changed.
   *
   * Only while this site is `awaiting-install`. A live or stale site has
   * nothing to watch for, and an unbounded timer on a dashboard somebody
   * leaves open is a request every few seconds until they close the laptop.
   * Leaving the site unmounts the provider and clears it for the same reason.
   * No new endpoint: this re-runs the list fetch the provider already makes.
   *
   * It used to live on the Sites page, polling only while the in-place detail
   * view was open; it moved here with the site (ADR 052), and the Sites page
   * no longer polls at all. The dependencies are the one fact that matters,
   * "is this site still awaiting install", and the stable `refetch`. The site
   * object itself is rebuilt by every poll, so depending on it would tear down
   * and re-arm the timer on each answer — a timer that never fires.
   */
  useEffect(() => {
    if (!isAwaitingInstall) return;

    const timer = setInterval(() => {
      void refetch();
    }, INSTALL_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isAwaitingInstall, refetch]);

  if (sites === null) {
    return error ? (
      <SiteLoadError message={error} onRetry={() => void refetch()} />
    ) : (
      <SiteLoading />
    );
  }

  if (!site) return <SiteNotFound />;

  return (
    <SiteScope site={site} refetch={refetch}>
      {children}
    </SiteScope>
  );
}

interface SiteScopeProps {
  site: SiteRecord;
  refetch: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * The install credentials and their guards, moved out of the old in-place
 * detail view (`SiteDetailView`) so every subpage, the header and the version
 * history read one copy. Mounted only once the site exists, so its initial
 * credentials are the site's own.
 */
function SiteScope({ site, refetch, children }: SiteScopeProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState(false);
  const credentialSiteId = useRef(site.id);
  const latestSelection = useRef({
    siteId: site.id,
    canInstall: Boolean(site.siteToken),
  });
  latestSelection.current = {
    siteId: site.id,
    canInstall: Boolean(site.siteToken),
  };
  const [credentials, setCredentials] = useState<SiteCredentials>({
    siteToken: site.siteToken,
    embedScript: site.embedScript,
  });

  useEffect(() => {
    // The layout keys the provider by `siteId`, so a site change remounts
    // this scope. That key is the first guard; this is the second, kept for
    // the day the router keeps a segment mounted. A credential rotated for
    // site A must never remain visible for site B, especially when B is a
    // viewer-only site with no install credentials. Same-site refreshes (the
    // install poll, the refetch after a rotation) deliberately do not
    // overwrite the local result: the list may still hold the pre-rotation
    // payload while this rotation has already made that snippet invalid.
    const didChangeSite = credentialSiteId.current !== site.id;
    const didLoseInstallAccess =
      !site.siteToken && (credentials.siteToken || credentials.embedScript);

    if (didChangeSite || didLoseInstallAccess) {
      credentialSiteId.current = site.id;
      setCredentials({
        siteToken: site.siteToken,
        embedScript: site.embedScript,
      });
      setRegenerated(false);
      setRegenerateError(null);
    }
  }, [
    credentials.embedScript,
    credentials.siteToken,
    site.id,
    site.siteToken,
    site.embedScript,
  ]);

  // Effects run after paint. During the first render for a newly selected
  // site, use its record immediately so the previous site's secret cannot
  // flash on screen while the state synchronisation above is queued. A
  // record without a token clears them in the same render: losing admin on a
  // refresh must not leave the old snippet on screen for one more paint.
  const displayedCredentials: SiteCredentials = !site.siteToken
    ? { siteToken: undefined, embedScript: undefined }
    : credentialSiteId.current === site.id
      ? credentials
      : { siteToken: site.siteToken, embedScript: site.embedScript };

  // The API's snippet when it sent one. The fallback reads a build-time
  // `NEXT_PUBLIC_WS_URL` (s07b task 5), so it runs only when the API sent a
  // token without a snippet. A member without credentials gets none at all:
  // the `YOUR_SITE_TOKEN` placeholder the detail view used to show them was a
  // snippet that could never work (s66c1 AC 5).
  const embedScript =
    displayedCredentials.embedScript ||
    (displayedCredentials.siteToken
      ? buildEmbedScript({
          siteId: site.id,
          siteToken: displayedCredentials.siteToken,
        })
      : undefined);

  const regenerateSnippet = async (): Promise<boolean> => {
    const requestedSiteId = site.id;
    setRegenerating(true);
    setRegenerateError(null);

    try {
      const response = await fetch(
        `/api/sites/${requestedSiteId}/regenerate-snippet`,
        { method: "POST" },
      );
      const body: {
        siteToken?: string;
        embedScript?: string;
        error?: string;
      } = await response.json();

      if (!response.ok || !body.siteToken || !body.embedScript) {
        throw new Error(body.error || "Failed to regenerate snippet");
      }

      // The owner may lose admin, or leave the site, while the request is in
      // flight. Its result belongs only to the site that initiated it and
      // must not replace the credentials now displayed for another site, or
      // reappear for a member who can no longer install.
      if (
        latestSelection.current.siteId !== requestedSiteId ||
        !latestSelection.current.canInstall
      ) {
        return false;
      }

      // These values feed every credential consumer under this provider: the
      // Install snippet and token, the Overview checklist and the version
      // history panel in the header. Keeping one state object prevents an old
      // token from surviving in a less-visible surface after the server has
      // revoked it.
      setCredentials({
        siteToken: body.siteToken,
        embedScript: body.embedScript,
      });
      setRegenerated(true);
      // Then bring the record into agreement with the server. Its answer
      // cannot undo the rotation: same-site refreshes never overwrite it.
      void refetch();
      return true;
    } catch (error) {
      setRegenerateError(
        error instanceof Error ? error.message : "Failed to regenerate snippet",
      );
      return false;
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <SiteContext.Provider
      value={{
        site,
        isAdmin: Boolean(site.siteToken),
        refetch,
        credentials: {
          siteToken: displayedCredentials.siteToken,
          embedScript,
        },
        regenerateSnippet,
        regeneration: {
          isPending: regenerating,
          error: regenerateError,
          hasSucceeded: regenerated && Boolean(displayedCredentials.siteToken),
        },
        clearRegenerationError: () => setRegenerateError(null),
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

function SiteLoading() {
  return (
    <PageShell
      title="Loading site…"
      nav={<Skeleton className="h-10 w-full max-w-md" />}
    >
      <div role="status" aria-label="Loading site" className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </PageShell>
  );
}

function SiteLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <PageShell title="Could not load this site">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </PageShell>
  );
}

/**
 * An id missing from the signed-in user's own site list. The list is filtered
 * by `site_permissions.user_id = session user`, so this is a foreign or
 * deleted site, and nothing else from the response may be shown.
 */
function SiteNotFound() {
  return (
    <PageShell title="Site not found">
      <Card variant="outline">
        <CardContent className="p-0">
          <EmptyState
            icon={Globe}
            title="This site isn't in your account."
            description="It may have been deleted, or it belongs to another account."
            action={
              <Button asChild variant="outline">
                <Link href="/dashboard/sites">Back to Sites</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
