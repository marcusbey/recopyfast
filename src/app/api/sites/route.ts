import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { buildEmbedScript } from "@/lib/sites/embed-script";
import { resolveEffectiveSiteStatus } from "@/lib/sites/site-status";
import { fetchPageScopedRows } from "@/lib/content/paged-elements";

const HISTORY_ID_BATCH_SIZE = 200;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch sites with permissions for the user
    const { data: permissions, error: permissionsError } = await serviceClient
      .from("site_permissions")
      .select("site_id, permission")
      .eq("user_id", user.id);

    if (permissionsError) {
      console.error("Error fetching site permissions:", permissionsError);
      return NextResponse.json(
        { error: "Failed to fetch site permissions" },
        { status: 500 },
      );
    }

    if (!permissions || permissions.length === 0) {
      return NextResponse.json({ sites: [] });
    }

    const siteIds = permissions.map((p) => p.site_id);

    // Fetch sites data
    const { data: sites, error: sitesError } = await serviceClient
      .from("sites")
      .select(
        "id, domain, name, created_at, updated_at, api_key, status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at",
      )
      .in("id", siteIds);

    if (sitesError) {
      console.error("Error fetching sites:", sitesError);
      return NextResponse.json(
        { error: "Failed to fetch sites" },
        { status: 500 },
      );
    }

    // Fetch stats for each site
    const sitesWithStats = await Promise.all(
      sites.map(async (site) => {
        let stats = {
          content_elements_count: 0,
          edits_count: 0,
          views: 0,
          last_activity: null as string | null,
        };

        try {
          // These reads describe the same site and do not depend on each other.
          // Starting them together matters on the dashboard, where repeating a
          // needless round trip for every site made list latency grow quickly.
          const [elementsResult, elementRowsResult] = await Promise.all([
            serviceClient
              .from("content_elements")
              .select("*", { count: "exact", head: true })
              .eq("site_id", site.id),
            // Resolve element IDs as a plain array (subquery objects are not
            // supported by the Supabase JS client v2 `.in()` filter).
            fetchPageScopedRows(
              () =>
                serviceClient
                  .from("content_elements")
                  .select("id, element_id")
                  .eq("site_id", site.id),
              null,
            ),
          ]);

          if (elementsResult.error || elementRowsResult.error) {
            throw elementsResult.error ?? elementRowsResult.error;
          }

          const elementIds: string[] = (elementRowsResult.data ?? []).map(
            (row: { id: string }) => row.id,
          );
          const batches: string[][] = [];
          for (
            let offset = 0;
            offset < elementIds.length;
            offset += HISTORY_ID_BATCH_SIZE
          ) {
            batches.push(
              elementIds.slice(offset, offset + HISTORY_ID_BATCH_SIZE),
            );
          }

          // `.in()` serializes every UUID into the request URL. Once
          // page-scoped identity pushed ordinary sites over 1,000 elements,
          // one unbounded list produced URLs large enough for proxies to
          // reject. Keep the bounded requests, but start every independent
          // batch together instead of adding one network wait per 200 rows.
          const historyResults = await Promise.all(
            batches.map(async (batch) => {
              const [countResult, activityResult] = await Promise.all([
                serviceClient
                  .from("content_history")
                  .select("*", { count: "exact", head: true })
                  .in("content_element_id", batch),
                serviceClient
                  .from("content_history")
                  .select("created_at")
                  .in("content_element_id", batch)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle(),
              ]);

              if (countResult.error || activityResult.error) {
                throw countResult.error ?? activityResult.error;
              }
              return {
                editsCount: countResult.count ?? 0,
                lastActivity: activityResult.data,
              };
            }),
          );

          const editsCount = historyResults.reduce(
            (total, result) => total + result.editsCount,
            0,
          );
          const lastActivity = historyResults.reduce<string | null>(
            (latest, result) =>
              result.lastActivity?.created_at &&
              (!latest || result.lastActivity.created_at > latest)
                ? result.lastActivity.created_at
                : latest,
            null,
          );
          stats = {
            content_elements_count: elementsResult.count ?? 0,
            edits_count: editsCount,
            views: 0, // TODO: Implement views tracking
            last_activity: lastActivity,
          };
        } catch (statsError) {
          // A broken aggregate must not hide every healthy site. The original
          // dashboard contract degraded stats to zero; s27 briefly let one
          // page/history read reject the route-wide Promise.all and return 500.
          console.error(
            `Error fetching stats for site ${site.id}:`,
            statsError,
          );
        }

        const permission = permissions.find((row) => row.site_id === site.id);
        const canInstall = permission?.permission === "admin";

        // The HMAC secret and a minted token are install credentials, not a
        // membership perk. Viewers and editors must not receive a fresh site
        // token just because they can see the site.
        const siteToken =
          canInstall && site.api_key
            ? buildSiteToken(site.id, site.api_key)
            : undefined;
        const embedScript = siteToken
          ? buildEmbedScript({ siteId: site.id, siteToken })
          : undefined;

        return {
          id: site.id,
          domain: site.domain,
          name: site.name,
          created_at: site.created_at,
          updated_at: site.updated_at,
          // The persisted state machine, resolved once per site.
          //
          // This used to read `elementsCount > 0 ? "active" : "verifying"` — a
          // count standing in for a status. It could not say when anything
          // happened, and it drew a site that reported for months and then went
          // quiet exactly like one whose script was never installed. `stale` is
          // derived here rather than stored; see @/lib/sites/site-status.
          status: resolveEffectiveSiteStatus(site),
          live_at: site.live_at ?? null,
          last_reported_at: site.last_reported_at ?? null,
          last_mismatch_domain: site.last_mismatch_domain ?? null,
          last_mismatch_at: site.last_mismatch_at ?? null,
          stats,
          ...(canInstall ? { siteToken, embedScript } : {}),
        };
      }),
    );

    return NextResponse.json({ sites: sitesWithStats });
  } catch (error) {
    console.error("Error in sites API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
