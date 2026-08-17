# ADR 021 — Branded origins are served by one wildcard domain and one wildcard certificate

- Status: accepted
- Date: 2026-08-17
- Scope: story `s20-agency-branded-subdomain`
- Settles: the "Watch" left open by [ADR 018](./018-tenant-scoped-serving-origin.md), and
  Blocking #1 of `docs/plans/s20-agency-branded-subdomain.md`

## Context

ADR 018 decided *how a branded origin is resolved* — one claims table, one resolver, five call
sites — and deliberately did not decide *where the branded host physically resolves*:

> **Watch — this ADR does not settle where the branded host physically resolves.** Whether
> `*.recopyfa.st` is served by the same Vercel project under one wildcard domain and one wildcard
> certificate, or whether each claimed subdomain is provisioned as an individual domain with its
> own certificate issuance, is recorded in the plan as **Blocking #1** and is explicitly an
> operator/Vercel decision, not a code decision.

The plan's shape depends on the answer: *"under wildcard, claiming is a database write and the host
already resolves; under per-subdomain issuance, claiming must call a provisioning API and poll it,
which is a task this plan does not currently contain."*

## Decision

**One wildcard domain, `*.recopyfa.st`, on the same Vercel project, with one wildcard
certificate.** Claiming a subdomain is a database write and nothing else. No code in this product
provisions DNS or a certificate, and none should.

This carries four requirements that are part of the decision, not commentary on it:

1. **Claimed subdomains are single-label.** A wildcard certificate for `*.recopyfa.st` does not
   cover `*.*.recopyfa.st`. `acme.recopyfa.st` is valid; `eu.acme.recopyfa.st` is not, and the
   `subdomain` column's validation rejects any label containing a dot before it is stored.
2. **A reserved list is enforced at claim time.** The wildcard matches every host in the zone,
   including ones the product already owns — `www`, `app`, `api`, `admin`, `embed`, `blog`,
   `docs`, `staging`, `preview`, `mail`. A claim on any of these is refused. Without this, the
   first agency to type `www` takes the canonical host, and ADR 018 provides no un-claim path.
3. **The branded host is canonical from the first byte and is never a redirect target** — the
   constraint ADR 018 binds regardless of provisioning, because a 308 reproduces incident B-11 on
   every client site of every agency. `canonicalizePublicAppUrl` (`embed-script.ts:29-40`) rewrites
   *only* the exact apex hostname, so branded hosts pass through it untouched; the `s20` suite
   asserts that, rather than assuming it.
4. **Unclaimed subdomains do not serve the app.** See Consequences — this is the price of the
   wildcard and it must be paid explicitly.

`agency_branded_origins.status` keeps its `pending | active` shape from ADR 018, but under a
wildcard its meaning narrows: `pending` is a **verification** state, not a provisioning one. The
host already resolves; `pending` means the system has not yet confirmed it serves, and it exists so
the resolver's fail-safe has something to fail toward. The plan's T2 two-step checklist (DNS, then
certificate) collapses to a single check — *does this host serve our app over TLS* — and its copy
("usually 5–30 minutes") is no longer accurate and is reworded to reflect near-immediate
availability.

## Considered options

- **(a) Per-subdomain domain registration with individual certificate issuance.** Rejected on
  three grounds. It requires the product to hold a Vercel API credential with domain-management
  authority and to call it from a user-triggered path — a new external dependency, on the
  provisioning plane rather than the data plane, in a story whose whole architecture (ADR 018) is
  "one row, one resolver." It adds a genuine asynchronous provisioning flow — call, poll, retry,
  surface failure — which `s20`'s plan does not contain and which would push it past complexity 4.
  And its failure modes are worse in the direction that matters: a certificate that fails to issue
  leaves a claimed-but-dead host, and ADR 018 gives no un-claim path to recover it.
- **(b) Wildcard DNS, but per-host certificates issued on demand.** Rejected as the worst of both:
  it keeps the asynchronous issuance flow of (a) while adding the open-host exposure of the
  wildcard, and gains nothing over (a) except a shorter DNS step.

## Consequences

**Every subdomain in the zone now reaches this application, claimed or not.** That is inherent to
a wildcard and it is the one real cost of this decision. Left unhandled it produces three distinct
problems: the full marketing site served from unlimited hostnames (duplicate content, and a search
engine choosing which one to rank); session cookies set on a host nobody intended; and the app
answering to a hostname no record ties to any account.

The decision is therefore incomplete without a host admission rule, and `s20` carries it:
**`src/middleware.ts` admits the canonical host and hosts holding an `active` claim; any other
host under `*.recopyfa.st` is redirected to the canonical origin.** A redirect is correct *here*
and forbidden for claimed hosts, and the distinction is exact: incident B-11 is about hosts a
snippet points at, and no snippet has ever pointed at an unclaimed host. The rule must be
fail-closed on lookup failure in the safe direction — an unavailable claims lookup treats the host
as unclaimed and redirects, never as claimed.

**Claiming is instant, and the UI should say so.** There is no propagation window to wait out. The
`pending` state should be short enough that a user rarely sees it; if it becomes a state users
routinely sit in, that indicates the verification check is wrong, not that provisioning is slow.

**One certificate is one renewal.** Its expiry is a single point of failure for every branded
origin at once — but the same is true of the canonical host, and it is one thing to monitor rather
than N. Under option (a) the failure would have been per-agency, quieter, and discovered later.

**Reversible in the direction that matters.** Moving from a wildcard to per-subdomain issuance
later requires provisioning a certificate for each already-claimed host, which is mechanical and
does not touch `serving-origin.ts`. The resolver's contract is unchanged by either choice, which is
exactly why ADR 018 was able to be decided before this one.
