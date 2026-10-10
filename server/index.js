const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const {
  isOriginAllowed,
  normalizePermissions,
  resolveGrant,
  verifySiteToken,
} = require('./auth');
const {
  createMemoryRateLimitStore,
  createRateLimiter,
  createRedisRateLimitStore,
} = require('./rate-limit');
const { securityHeaders } = require('./security-headers');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function sanitizeContent(content) {
  if (!content) return '';
  return DOMPurify.sanitize(String(content), {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}


/**
 * How often a connected editor's grant is re-checked when it is not talking.
 * One minute: long enough that the sweep costs one indexed SELECT per open
 * editing session per minute, short enough that "I removed them" and "they
 * stopped receiving" are the same event to a human.
 */
const DEFAULT_REVALIDATION_INTERVAL_MS = 60 * 1000;

/**
 * The client's address, for the per-address rate-limit buckets.
 *
 * On Fly every connection reaches the machine from fly-proxy, so the TCP peer
 * (`handshake.address`) is the proxy's address for every client and a bucket
 * keyed on it is one bucket for the world. Fly's proxy reports the client in
 * `Fly-Client-IP` — set by the proxy, and the header Fly recommends over the
 * spoofable `X-Forwarded-For` (docs/research/s79-headers-csp-ws.md §4). Off
 * Fly, any client could send that header, so it is read only when
 * `trustFlyClientIp` says this process sits behind the proxy.
 */
function resolveClientAddress(handshake, { trustFlyClientIp }) {
  if (trustFlyClientIp) {
    const reported = handshake.headers['fly-client-ip'];
    if (typeof reported === 'string' && reported.trim() !== '') {
      return reported.trim();
    }
  }
  return handshake.address || 'unknown';
}

/**
 * Build the realtime service.
 *
 * A factory rather than module-load side effects. `startServer(PORT)` used to
 * run the moment this file was required, which is the single reason the service
 * had no integration test: importing it bound a port. Everything the process
 * needs is now an argument — the Supabase client, the rate-limit store, the
 * port — so a test can boot the real server on port 0 with doubles it controls
 * and assert against the running thing rather than against a copy of its logic.
 *
 * The CLI path (`require.main === module`, bottom of this file) is the only
 * place that reads process.env and starts anything.
 */
function createRealtimeServer(options = {}) {
  const {
    port = 4001,
    supabase = null,
    rateLimitStore = createMemoryRateLimitStore(),
    rateLimit = {},
    revalidationIntervalMs = DEFAULT_REVALIDATION_INTERVAL_MS,
    // True only behind Fly's proxy (startFromCli: FLY_APP_NAME is set on
    // every Fly Machine). See resolveClientAddress.
    trustFlyClientIp = false,
  } = options;

  const supabaseEnabled = Boolean(supabase);
  const rateLimiter = createRateLimiter({
    store: rateLimitStore,
    limits: rateLimit,
  });

  const app = express();
  const httpServer = createServer(app);

  // A static origin allowlist cannot work here. The widget runs on EVERY
  // customer's own domain, so a fixed list would mean adding each new customer to
  // an env var and redeploying — and until then their editors simply cannot
  // connect. That is what happened: the handshake was refused at the CORS layer,
  // so sendContentMap() never ran, no content element was ever registered, and
  // every save failed with "Content element not found".
  //
  // Authorisation does not depend on this layer. The connection handler below
  // looks the site up by its HMAC token and rejects the socket unless the request
  // host matches that site's REGISTERED domain (see the origin pin in the
  // connection handler). That is a per-site check, and strictly stronger than a
  // global list.
  //
  // Credentials stay off: nothing here authenticates by cookie — the site token
  // travels in the handshake query.
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
      credentials: false
    },
    // WebSocket only — no polling fallback. ADR 023.
    //
    // Refusing polling HERE, at the server, is the part that must not be dropped.
    // Setting it on the clients alone leaves a server that still accepts polling,
    // so any client that misses the option — a cached older embed artifact among
    // them — establishes a session that appears to work and then fails on its next
    // request. Refusing at the door turns a confusing intermittent bug into an
    // immediate, legible one.
    //
    // Why not polling at all: socket.io's handshake is stateful. The session id
    // issued by one process means nothing to another, so a polling exchange spread
    // across two machines dies with `Session ID unknown`. This service runs one
    // machine today (see fly.toml) and that is what keeps ROOMS coherent — the
    // transport pin is what keeps the HANDSHAKE coherent. Two independent problems;
    // do not treat the single machine as covering both.
    //
    // The cost, accepted under ADR 004: a client on a WebSocket-hostile network
    // loses realtime with no fallback. HTTP stays authoritative and realtime is
    // additive, so that degrades an enhancement rather than breaking the product.
    transports: ['websocket']
  });

  // TOMBSTONE — s79 (s69 L13). `app.use(cors())` stood here: every HTTP
  // response, `/health` included, answered `Access-Control-Allow-Origin: *`,
  // and Express added `X-Powered-By: Express`. Nothing browser-side reads this
  // surface, so it answers no CORS at all (the handshake's own CORS, above, is
  // engine.io's and unchanged). See ./security-headers.js.
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json());

  // Liveness, and nothing else. Fly's check (fly.toml), the uptime workflow
  // and the app's realtime probe (src/app/api/health/route.ts) need a 2xx.
  //
  // TOMBSTONE — s79 (s69 L13). This answered, unauthenticated,
  // `connections: io.engine.clientsCount` plus the Supabase mode and a
  // message: a live count of open editing sessions for anyone to poll. The
  // Supabase mode told an operator nothing either — in production the process
  // refuses to boot without Supabase (assertProductionEnvironment).
  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });

  // Everything else is a 404 answered here rather than by Express's
  // finalhandler, which replaces the Content-Security-Policy set above with
  // its own and renders an HTML page naming the method and path.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Store active connections by site
  const siteConnections = new Map();
  const userConnections = new Map();

  function refuse(socket, error) {
    socket.emit('auth-error', { error });
    socket.disconnect();
  }

  /**
   * The site row a socket's token is checked against, as it stands now.
   * `{ site }` (null when the row is gone) or `{ failed: true }` — never
   * throws, so one lookup can be shared by every socket of a site in a sweep.
   */
  async function readSiteKey(siteId) {
    try {
      const { data, error } = await supabase
        .from('sites')
        .select('id, api_key')
        .eq('id', siteId)
        .maybeSingle();
      if (error) {
        console.error('[revalidation] site lookup failed:', error.message);
        return { failed: true };
      }
      return { site: data };
    } catch (error) {
      console.error('[revalidation] site lookup failed:', error.message);
      return { failed: true };
    }
  }

  /**
   * Re-check what a socket was admitted on, and drop it if it no longer stands:
   * first its site token against the site's CURRENT key, then, for an editor,
   * its grant.
   *
   * TOMBSTONE — s79, ADR 027's follow-up. This returned early for every socket
   * but a staging one, and nothing else re-read the key, so "Regenerate
   * snippet" refused reconnects while every socket already open with the old
   * token stayed open for as long as its tab did. A missing row reads as
   * revoked; a lookup that FAILED is refused too ("has not answered yes", as
   * resolveGrant and s68c's review hold for grants).
   *
   * TOMBSTONE — `validateStagingAccess` and `validateEditSessionAccess` used to
   * live here as two near-identical local functions called exactly once each,
   * at the handshake, with their answer cached on `socket.data`. Everything
   * afterwards read the cache. They are now one call into `resolveGrant`
   * (server/auth.js), made on every message that reaches a permission check and
   * again on the revalidation sweep. See the comment there for why this is a
   * SELECT rather than a TTL cache.
   *
   * Refusal is `auth-error` then `disconnect`, in that order: the widget
   * listens for `auth-error` (recopyfast.src.js:2745) and that is how a revoked
   * editor finds out rather than simply going quiet.
   */
  async function revalidateSocket(socket, { lookupSite = readSiteKey } = {}) {
    // Degraded mode verified nothing at the handshake, so there is nothing to
    // re-verify; `siteToken` is only ever set after a verified handshake.
    if (!supabaseEnabled || !socket.data.siteToken) return true;

    const lookup = await lookupSite(socket.data.siteId);
    if (lookup.failed) {
      refuse(socket, 'Site verification failed');
      return false;
    }
    if (
      !lookup.site ||
      !verifySiteToken(socket.data.siteId, lookup.site.api_key, socket.data.siteToken)
    ) {
      refuse(socket, 'Site token revoked');
      return false;
    }

    if (!socket.data.isStaging) return true;

    const grant = await resolveGrant({
      supabase,
      siteId: socket.data.siteId,
      stagingToken: socket.data.stagingToken,
      editToken: socket.data.editToken,
      userAgent: socket.data.userAgent,
    });

    if (!grant.valid) {
      refuse(socket, grant.error || 'Editor access revoked');
      return false;
    }

    // A downgrade is a revocation of part of a grant, so the refreshed
    // permissions replace the cached ones rather than merely being compared.
    socket.data.stagingPermissions = normalizePermissions(grant.permissions);
    socket.data.stagingEmail = grant.email || grant.userId || 'unknown';
    socket.data.stagingAccessId = grant.accessId || null;
    return true;
  }

  /**
   * One pass over every socket that was admitted on a verified token.
   *
   * The sweep exists for the socket that says NOTHING. Per-message
   * re-resolution only fires for a socket that talks: a revoked but silent
   * editor is still in `site:{id}:staging`, receiving every other editor's
   * unpublished copy, and a socket opened with a rotated key would stay open
   * for as long as its tab did. This is what closes both.
   *
   * Every socket, not only editors, since s79 — and so the key is read ONCE
   * per site per pass and shared by that site's sockets: the widget opens a
   * socket for every visitor of a page carrying `data-ws-url`, so a read per
   * socket would scale with traffic. Grants stay per socket (each is its own
   * row). Returned by the factory so a test can run one pass deterministically.
   */
  async function revalidateAll() {
    const siteLookups = new Map();
    const lookupSite = (siteId) => {
      if (!siteLookups.has(siteId)) siteLookups.set(siteId, readSiteKey(siteId));
      return siteLookups.get(siteId);
    };

    const checks = [];
    for (const socket of io.sockets.sockets.values()) {
      if (!socket.data.siteToken) continue;
      checks.push(
        revalidateSocket(socket, { lookupSite }).catch((error) => {
          console.error('[revalidation] sweep failed for socket:', error.message);
        })
      );
    }
    await Promise.all(checks);
  }

  /**
   * `unref()` so a running sweep never keeps the process (or a test worker)
   * alive on its own.
   */
  const revalidationTimer = supabaseEnabled
    ? setInterval(() => {
        revalidateAll().catch((error) => {
          console.error('[revalidation] sweep failed:', error.message);
        });
      }, revalidationIntervalMs)
    : null;
  if (revalidationTimer && typeof revalidationTimer.unref === 'function') {
    revalidationTimer.unref();
  }

  // Socket.io connection handling
  io.on('connection', async (socket) => {
    const { siteId, editMode, token, stagingMode, stagingToken, editToken } = socket.handshake.query;
    const originHeader = socket.handshake.headers.origin || socket.handshake.headers.referer;
    // The browser sends the same User-Agent on the WebSocket upgrade as on its
    // fetches, so this is the string HTTP hashed when the editor verified.
    // Read once, here: the handshake headers are the only ones a socket has.
    const userAgent = socket.handshake.headers['user-agent'];
    const isStaging = stagingMode === 'true' || stagingMode === true;

    if (!siteId) {
      socket.disconnect();
      return;
    }

    const clientAddress = resolveClientAddress(socket.handshake, {
      trustFlyClientIp,
    });

    function refuseOverLimit() {
      socket.emit('auth-error', { error: 'Rate limit exceeded' });
      socket.disconnect();
    }

    // RATE LIMIT BEFORE AUTHORIZATION (AGENTS.md).
    //
    // Authorization here is a `sites` lookup — a database round trip — so a
    // limiter placed behind it never sees the flood it exists to stop; it just
    // makes the flood expensive. This one is keyed on the CALLER.
    //
    // TOMBSTONE — s79 (s69 L14). The bucket spent here used to be the
    // per-SITE one, keyed on the handshake's own site id, before the token was
    // even present-checked. 121 handshakes carrying nothing therefore locked
    // every real editor of that site out of realtime for a minute. The per-site
    // bucket is now spent only by a handshake that verified (admitToSiteBuckets
    // below); a flood from one address exhausts that address's bucket alone.
    const handshakeVerdict = await rateLimiter.checkHandshake({
      address: clientAddress,
    });
    if (!handshakeVerdict.allowed) {
      refuseOverLimit();
      return;
    }

    /**
     * The per-site buckets (ADR 002 rule 4), for a handshake whose token and
     * origin verified. Before verification they would be spendable by anyone
     * who knows a site id.
     */
    async function admitToSiteBuckets() {
      const verdict = await rateLimiter.checkConnection({
        siteId,
        address: clientAddress,
      });
      if (!verdict.allowed) refuseOverLimit();
      return verdict.allowed;
    }

    if (!token) {
      socket.emit('auth-error', { error: 'Missing site token' });
      socket.disconnect();
      return;
    }

    if (supabaseEnabled) {
      try {
        const { data: site, error } = await supabase
          .from('sites')
          .select('id, domain, api_key')
          .eq('id', siteId)
          .single();

        if (error || !site) {
          socket.emit('auth-error', { error: 'Site not found' });
          socket.disconnect();
          return;
        }

        if (!verifySiteToken(siteId, site.api_key, token)) {
          socket.emit('auth-error', { error: 'Invalid site token' });
          socket.disconnect();
          return;
        }

        // The pin is unconditional — see the A-2 comment on isOriginAllowed().
        if (!isOriginAllowed(site.domain, originHeader)) {
          socket.emit('auth-error', { error: 'Origin not allowed' });
          socket.disconnect();
          return;
        }

        // Verified: only now may this handshake spend the site's bucket —
        // and before the grant lookup below, which is a second round trip.
        if (!(await admitToSiteBuckets())) return;

        socket.data.siteToken = token;
        socket.data.siteId = siteId;

        // Validate editor access if in staging/edit mode
        if (isStaging && (stagingToken || editToken)) {
          const grant = await resolveGrant({
            supabase,
            siteId,
            stagingToken,
            editToken,
            userAgent,
          });

          if (!grant.valid) {
            socket.emit('auth-error', { error: grant.error || 'Invalid editor access' });
            socket.disconnect();
            return;
          }

          // The CREDENTIALS are what is kept on the socket, not the verdict.
          // Caching the verdict is the M5 defect: it made "is this editor still
          // allowed" a question answered once, at connect time, forever.
          //
          // The User-Agent travels with them: the device binding (s68c, M7)
          // is re-checked on every re-resolution, so the sweep can drop a
          // socket whose verification passed its 12 h TTL while it was open.
          socket.data.isStaging = true;
          socket.data.stagingToken = stagingToken;
          socket.data.editToken = editToken;
          socket.data.userAgent = userAgent;
          socket.data.stagingEmail = grant.email || grant.userId || 'unknown';
          socket.data.stagingPermissions = normalizePermissions(grant.permissions);
          socket.data.stagingAccessId = grant.accessId || null;
        }
      } catch (error) {
        console.error('Site verification failed:', error);
        socket.emit('auth-error', { error: 'Site verification failed' });
        socket.disconnect();
        return;
      }
    } else {
      // Degraded, development-only mode: no Supabase means no site row, so
      // there is no api_key to verify the token against and no domain to pin
      // the origin to. The connection is admitted to the site's LIVE room and
      // nothing else.
      //
      // TOMBSTONE — this branch used to read `if (isStaging) {
      // socket.data.isStaging = true; ... }`, i.e. it granted staging-room
      // membership because the client asked for it. Staging rooms carry
      // unpublished copy. The branch is gated on env presence, not on
      // NODE_ENV, so a single typo'd SUPABASE_SERVICE_ROLE_KEY in production
      // turned the service into "anyone can watch any site's unpublished
      // edits", with no error anywhere. Production now refuses to boot at all
      // in that state (see startFromCli), and this branch grants nothing.
      console.warn(
        'Supabase not configured - running degraded: no token verification, no staging rooms'
      );
      if (!(await admitToSiteBuckets())) return;
    }

    // Join appropriate room based on staging mode
    if (socket.data.isStaging) {
      socket.join(`site:${siteId}:staging`);
    } else {
      socket.join(`site:${siteId}`);
    }

    // Track connections
    if (!siteConnections.has(siteId)) {
      siteConnections.set(siteId, new Set());
    }
    siteConnections.get(siteId).add(socket.id);

    /**
     * Register a message handler behind the per-socket message budget.
     *
     * Every inbound event goes through here, so adding a handler cannot forget
     * the limiter — which is how the connection-level limit stops being the
     * only one. An acknowledged event (`content-update` carries an ack) is
     * answered rather than dropped silently: a client left waiting on an ack
     * that will never come is a hang, not a refusal.
     */
    function onMessage(event, handler) {
      socket.on(event, async (...args) => {
        const ack =
          typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;

        const verdict = await rateLimiter.checkMessage({ socketId: socket.id });
        if (!verdict.allowed) {
          socket.emit('rate-limit-error', { error: 'Rate limit exceeded' });
          if (ack) ack({ ok: false, error: 'Rate limit exceeded' });
          return;
        }

        return handler(...args);
      });
    }

    // Handle content map from embed script.
    //
    // TOMBSTONE — this handler used to upsert `content_elements` under the
    // service-role key. The write belongs to POST /api/content/:siteId, which
    // the widget calls UNCONDITIONALLY at recopyfast.src.js:2821, before the
    // socket emit at :2833 that reaches here. The socket copy was therefore
    // never the registering write; it was a second, unauthorised one, with no
    // permission check at all, on attacker-choosable element ids. ADR 004 rule
    // 1: HTTP stays authoritative, realtime broadcasts. Do not re-add it "for
    // symmetry" — two writers of one row disagree silently, which is the exact
    // failure that rule exists to prevent.
    //
    // What stays is the fan-out: dashboards watching this site learn that a page
    // reported its inventory.
    onMessage('content-map', async (data) => {
      try {
        const { url, contentMap, token: messageToken } = data || {};

        if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
          socket.emit('auth-error', { error: 'Invalid site token' });
          return;
        }

        // TOMBSTONE — s79 review F8. Comparing the message token with the
        // handshake token only proves the caller repeated the credential it
        // connected with. After "Regenerate snippet" both values still match,
        // although that token no longer verifies against `sites.api_key`, so
        // the socket could fan out a URL and element count until the next
        // 60-second sweep. Re-resolve before the emit, exactly as the other
        // message paths do; a rotated token or failed site read disconnects
        // and nothing reaches the dashboard room.
        if (!(await revalidateSocket(socket))) {
          return;
        }

        // Notify dashboard clients about new content
        io.to(`dashboard:${siteId}`).emit('content-map-updated', {
          siteId,
          url,
          elementCount: Object.keys(contentMap || {}).length
        });

      } catch (error) {
        console.error('Error processing content map:', error);
      }
    });

    // Handle content updates from dashboard or staging
    onMessage('content-update', async (data, ack) => {
      const reply = (payload) => {
        if (typeof ack === 'function') {
          ack(payload);
        }
      };
      const isStagingSocket = socket.data.isStaging;

      try {
        const { elementId, content, language = 'en', variant = 'default', token: messageToken } = data;
        // Attribute absence has semantic weight. A missing href/alt means the
        // author never supplied it; turning that into an empty string changes
        // the customer's DOM. Keep explicit empty strings (intentional clears)
        // while omitting keys the persisted HTTP update did not carry.
        const attributes = {};
        if (typeof data.href === 'string') {
          attributes.href = data.href;
        }
        if (typeof data.alt === 'string') {
          attributes.alt = data.alt;
        }

        if (socket.data.siteToken && socket.data.siteToken !== messageToken) {
          socket.emit('auth-error', { error: 'Invalid site token' });
          reply({ ok: false, error: 'Invalid site token' });
          return;
        }

        if (!isStagingSocket) {
          socket.emit('update-error', {
            error: 'Live updates must be saved through staging and published explicitly'
          });
          reply({ ok: false, error: 'Live updates must be saved through staging and published explicitly' });
          return;
        }

        // M5 — re-resolve the grant before every permission decision. This used
        // to read `socket.data.stagingPermissions` alone, which was written
        // once at the handshake and never refreshed, so a revoked editor kept
        // editing for as long as the tab stayed open. revalidateSocket()
        // refreshes the permissions it is about to be judged on, and
        // disconnects when the grant is gone.
        if (!(await revalidateSocket(socket))) {
          reply({ ok: false, error: 'Editor access revoked' });
          return;
        }

        const permissions = socket.data.stagingPermissions || [];
        const hasEditPermission = permissions.includes('edit') ||
                                   permissions.includes('publish') ||
                                   permissions.includes('admin');
        if (!hasEditPermission) {
          socket.emit('update-error', { error: 'Edit permission required' });
          reply({ ok: false, error: 'Edit permission required' });
          return;
        }

        const sanitizedContent = sanitizeContent(content);
        const now = new Date().toISOString();

        // TOMBSTONE — a `content_elements` update and a `staging_history`
        // insert used to happen right here, guarded by `!data.persisted`.
        //
        // PUT /api/staging/content/:siteId owns both. `persistContentUpdate`
        // (recopyfast.src.js:2625) performs that authenticated PUT and only then
        // emits with `persisted: true`, so the real client never reached this
        // branch — only a hand-crafted one did, and for that caller the branch
        // was a service-role write into another tenant's staged copy plus a
        // forged audit row attributing it to whatever email the handshake
        // carried. ADR 004 rule 1: realtime broadcasts, it never writes.
        //
        // `persisted` is consequently no longer read at all: there is nothing
        // left for it to gate.

        // Broadcast to appropriate room
        if (isStagingSocket) {
          // Staging: broadcast only to staging room
          socket.to(`site:${siteId}:staging`).emit('content-update', {
            elementId,
            content: sanitizedContent,
            language,
            variant,
            ...attributes,
            isStaging: true,
            updatedBy: socket.data.stagingEmail
          });
        } else {
          // Live: broadcast to live room
          socket.to(`site:${siteId}`).emit('content-update', {
            elementId,
            content: sanitizedContent,
            language,
            variant,
            ...attributes
          });
        }

        // Notify dashboard users
        socket.to(`dashboard:${siteId}`).emit('content-updated', {
          elementId,
          content: sanitizedContent,
          ...attributes,
          updatedBy: socket.id,
          timestamp: now,
          isStaging: isStagingSocket
        });

        reply({ ok: true });

      } catch (error) {
        console.error('Error processing content update:', error);
        socket.emit('update-error', { error: 'Internal server error' });
        reply({ ok: false, error: 'Internal server error' });
      }
    });

    // Handle dashboard connections
    onMessage('join-dashboard', async (data) => {
      const { siteId: dashboardSiteId, userId } = data || {};

      // Authorization: the dashboard room must match the site id that was
      // authenticated during the handshake.  Allowing arbitrary room joins
      // would let any authenticated socket subscribe to another site's events.
      if (!dashboardSiteId || dashboardSiteId !== siteId) {
        socket.emit('auth-error', {
          error: 'Unauthorized: dashboard site id does not match authenticated site'
        });
        return;
      }

      // TOMBSTONE — s07a review MAJOR 2, closed in s68c. The site-id match
      // above used to be the ONLY check, and every persisted `content-update`
      // is fanned out to this room as `content-updated` carrying the staged
      // copy. The site token that opens a socket ships as a plain attribute in
      // the customer's page markup, so any visitor could join and read
      // unpublished drafts: the review proved a plain viewer received
      // "UNPUBLISHED SECRET DRAFT" (docs/reviews/s07a-realtime-service-
      // hardening.md). No production client emits this event (s68c research),
      // so the room is gated rather than removed; it stays available to a
      // future dashboard client that holds an editor credential.
      //
      // Two conditions, both required. `isStaging` alone is a flag written at
      // the handshake, and trusting a handshake-time verdict is the M5 defect
      // — so the grant is re-resolved here, as it stands now. A plain viewer
      // is refused but keeps the live room it is entitled to; an editor whose
      // grant has gone is dropped by revalidateSocket, as everywhere else.
      if (!socket.data.isStaging) {
        socket.emit('auth-error', {
          error: 'Unauthorized: the dashboard room requires editor access'
        });
        return;
      }
      if (!(await revalidateSocket(socket))) {
        return;
      }

      socket.join(`dashboard:${dashboardSiteId}`);

      if (userId) {
        userConnections.set(socket.id, userId);
      }
    });

    // TOMBSTONE — six handlers were removed here, and none of them may come
    // back on this socket. Each wrote `content_elements` or called
    // `create_content_version` / `restore_content_version` /
    // `publish_staging_content_atomic` under the SERVICE-ROLE key, and a grep
    // across `src/` and `public/embed/recopyfast.src.js` finds no client that
    // has ever emitted any of them — the only emitters are `content-map`
    // (recopyfast.src.js:2834) and `content-update` (:2670, :2676). The service
    // has never been deployed, so an out-of-repo client cannot exist either.
    //
    //   bulk-update            → POST /api/bulk/update
    //   switch-language        → /api/edit-board/languages
    //   restore-version        → /api/edit-board/history
    //   activate-theme         → /api/edit-board/themes
    //   staging-publish        → POST /api/staging/publish
    //   ab-test-status-change  → (no twin: 3099c07 closed the HTTP one)
    //
    // Those routes stay, with their tests. Frozen means unexposed, not deleted.
    //
    // `ab-test-status-change` is the one worth naming twice: it had no token
    // re-check and no permission check whatsoever, only a site-id match against
    // the handshake. Any holder of the public site token — which ships as a
    // plain attribute in the customer's own page markup — could broadcast an
    // arbitrary A/B status to every client in `site:{id}` and `dashboard:{id}`.
    // 3099c07 closed exactly that hole on the HTTP side; standing this service
    // up would have re-opened it on the socket.

    // Handle disconnection
    socket.on('disconnect', () => {
      // Remove from site connections
      if (siteConnections.has(siteId)) {
        siteConnections.get(siteId).delete(socket.id);
        if (siteConnections.get(siteId).size === 0) {
          siteConnections.delete(siteId);
        }
      }

      // Remove from user connections
      userConnections.delete(socket.id);
    });
  });

  /**
   * Bind the configured port, or reject.
   *
   * There is deliberately no port walking. The previous startServer() retried
   * 4001→4010 on EADDRINUSE, which is convenient under `npm run dev` and wrong
   * everywhere else: fly.toml:95 (WS_PORT) and :99 (internal_port) pin 4001, so
   * a silent shift to 4002 presents as a failing deploy with healthy logs (T9).
   * Port 0 stays legal and means "give me an ephemeral port" — that is how the
   * integration harness binds.
   */
  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        const address = httpServer.address();
        resolve(address && typeof address === 'object' ? address.port : port);
      };

      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port);
    });
  }

  function close() {
    if (revalidationTimer) {
      clearInterval(revalidationTimer);
    }
    return new Promise((resolve) => {
      io.close(() => {
        httpServer.close(() => resolve());
      });
    });
  }

  return { app, io, httpServer, listen, close, revalidateAll };
}

// ---------------------------------------------------------------------------
// CLI entry point. Nothing below runs when this module is merely required.
// ---------------------------------------------------------------------------

function installCrashHandlers() {
  // Crash safety: log and exit so the platform (Fly.io, Docker, PM2, etc.)
  // can restart the process.  Without these handlers an unhandled rejection
  // silently kills the event loop with no diagnostic output.
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException – restarting process:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection – restarting process:', reason);
    process.exit(1);
  });
}

function loadEnvironment() {
  // ENV LOADING: resolve paths absolutely so the server works whether it is
  // started from the repo root, the server/ directory, or inside a container
  // where only process.env is populated.  We try several candidate paths in
  // order of preference and fall back gracefully if none exist.
  const envCandidates = [
    path.resolve(__dirname, '.env.local'),         // server/.env.local
    path.resolve(__dirname, '..', '.env.local'),   // repo-root/.env.local (dev)
    path.resolve(__dirname, '.env'),               // server/.env
    path.resolve(__dirname, '..', '.env'),         // repo-root/.env
  ];
  for (const envPath of envCandidates) {
    const result = require('dotenv').config({ path: envPath });
    if (!result.error) {
      console.log(`✓ Loaded env from ${envPath}`);
      break;
    }
  }
  // If none of the files exist, process.env values already set by the container
  // runtime (Fly secrets, Docker --env, etc.) are used as-is – no error thrown.
}

function resolveEnvironment() {
  const requiredEnvVars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  };

  const missingVars = [];
  const invalidUrls = [];

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value || value.includes('your_') || value === 'undefined') {
      missingVars.push(key);
    } else if (key.includes('URL') && !isValidUrl(value)) {
      invalidUrls.push(key);
    }
  }

  return { missingVars, invalidUrls };
}

function createSupabaseFromEnv() {
  const { missingVars, invalidUrls } = resolveEnvironment();

  if (missingVars.length > 0 || invalidUrls.length > 0) {
    console.warn('⚠ Running in development mode without Supabase');
    if (missingVars.length > 0) {
      console.warn('  Missing environment variables:', missingVars.join(', '));
    }
    if (invalidUrls.length > 0) {
      console.warn('  Invalid URLs:', invalidUrls.join(', '));
    }
    console.warn('  Set up Supabase credentials in .env.local to enable persistence');
    return null;
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('✓ Supabase client initialized successfully');
  return client;
}

/**
 * In production, a missing or invalid required variable is a refusal to start,
 * not a warning.
 *
 * AGENTS.md non-negotiable 8: validate presence at startup and fail loudly. The
 * degraded no-Supabase mode below is a development convenience; reaching it in
 * production means the service is running with no token verification and no
 * origin pin, which is indistinguishable from a healthy deployment in every
 * signal an operator looks at — `/health` answers 200 and the process stays up.
 * Refusing to boot is the only failure mode that surfaces.
 */
function assertProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;

  const { missingVars, invalidUrls } = resolveEnvironment();
  const problems = [
    ...missingVars.map((name) => `${name} (missing)`),
    ...invalidUrls.map((name) => `${name} (not a valid URL)`),
  ];

  // REDIS_URL is required in production for the same reason the limiter denies
  // on store failure: without a store there is no limit, and this process
  // authenticates with a credential published in the customer's page markup.
  // Refusing to boot is louder than refusing every connection at runtime, which
  // is what the fail-closed limiter would otherwise do all day.
  if (!process.env.REDIS_URL) {
    problems.push('REDIS_URL (missing)');
  }

  if (problems.length > 0) {
    console.error(
      '✗ Refusing to start in production. Required environment is missing or invalid:',
      problems.join(', ')
    );
    process.exit(1);
  }
}

function startFromCli() {
  installCrashHandlers();
  loadEnvironment();
  assertProductionEnvironment();

  const supabase = createSupabaseFromEnv();
  const rateLimitStore = process.env.REDIS_URL
    ? createRedisRateLimitStore({ url: process.env.REDIS_URL })
    : createMemoryRateLimitStore();
  if (!process.env.REDIS_URL) {
    console.warn(
      '⚠ REDIS_URL is not set - rate limiting is in-process and correct for one instance only'
    );
  }

  const port = Number(process.env.WS_PORT) || 4001;
  const server = createRealtimeServer({
    port,
    supabase,
    rateLimitStore,
    // Every Fly Machine has FLY_APP_NAME, and every request to one came
    // through fly-proxy, which sets Fly-Client-IP. See resolveClientAddress.
    trustFlyClientIp: Boolean(process.env.FLY_APP_NAME),
  });

  server.listen().then(
    (boundPort) => {
      console.log(`✓ WebSocket server running on port ${boundPort}`);
      if (!supabase) {
        console.log('⚠ Running in development mode - set up Supabase for persistence');
      }
    },
    (error) => {
      console.error(`✗ Failed to bind port ${port}: ${error.message}`);
      process.exit(1);
    }
  );

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close().then(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

module.exports = {
  createRealtimeServer,
  sanitizeContent,
};

if (require.main === module) {
  startFromCli();
}
