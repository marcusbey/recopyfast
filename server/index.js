const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
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

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      connections: io.engine.clientsCount,
      supabase: supabaseEnabled ? 'connected' : 'disabled',
      message: supabaseEnabled ? 'All systems operational' : 'Running in development mode - set up Supabase for full functionality'
    });
  });

  // Store active connections by site
  const siteConnections = new Map();
  const userConnections = new Map();

  /**
   * Re-resolve the grant a socket is holding, and drop the socket if it no
   * longer stands.
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
  async function revalidateSocket(socket) {
    if (!socket.data.isStaging) return true;

    const grant = await resolveGrant({
      supabase,
      siteId: socket.data.siteId,
      stagingToken: socket.data.stagingToken,
      editToken: socket.data.editToken,
    });

    if (!grant.valid) {
      socket.emit('auth-error', { error: grant.error || 'Editor access revoked' });
      socket.disconnect();
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
   * The sweep exists for the socket that says NOTHING.
   *
   * Per-message re-resolution only fires for a socket that talks. Once the
   * socket stopped writing (ADR 004 rule 1) the residual exposure of a revoked
   * but silent connection is disclosure — it is still in `site:{id}:staging`
   * and still receiving every other editor's unpublished copy — and this is
   * what closes it.
   *
   * `unref()` so a running sweep never keeps the process (or a test worker)
   * alive on its own.
   */
  const revalidationTimer = supabaseEnabled
    ? setInterval(() => {
        for (const socket of io.sockets.sockets.values()) {
          if (!socket.data.isStaging) continue;
          revalidateSocket(socket).catch((error) => {
            console.error('[revalidation] sweep failed for socket:', error.message);
          });
        }
      }, revalidationIntervalMs)
    : null;
  if (revalidationTimer && typeof revalidationTimer.unref === 'function') {
    revalidationTimer.unref();
  }

  // Socket.io connection handling
  io.on('connection', async (socket) => {
    const { siteId, editMode, token, stagingMode, stagingToken, editToken } = socket.handshake.query;
    const originHeader = socket.handshake.headers.origin || socket.handshake.headers.referer;
    const isStaging = stagingMode === 'true' || stagingMode === true;

    if (!siteId) {
      socket.disconnect();
      return;
    }

    // RATE LIMIT BEFORE AUTHORIZATION (AGENTS.md).
    //
    // Authorization here is a `sites` lookup — a database round trip — so a
    // limiter placed behind it never sees the flood it exists to stop; it just
    // makes the flood expensive. The only thing needed to compute the bucket is
    // the handshake's own site id, which is why this sits immediately after the
    // presence check and before everything else.
    const connectionVerdict = await rateLimiter.checkConnection({
      siteId,
      address: socket.handshake.address,
    });
    if (!connectionVerdict.allowed) {
      socket.emit('auth-error', { error: 'Rate limit exceeded' });
      socket.disconnect();
      return;
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

        socket.data.siteToken = token;
        socket.data.siteId = siteId;

        // Validate editor access if in staging/edit mode
        if (isStaging && (stagingToken || editToken)) {
          const grant = await resolveGrant({
            supabase,
            siteId,
            stagingToken,
            editToken,
          });

          if (!grant.valid) {
            socket.emit('auth-error', { error: grant.error || 'Invalid editor access' });
            socket.disconnect();
            return;
          }

          // The CREDENTIALS are what is kept on the socket, not the verdict.
          // Caching the verdict is the M5 defect: it made "is this editor still
          // allowed" a question answered once, at connect time, forever.
          socket.data.isStaging = true;
          socket.data.stagingToken = stagingToken;
          socket.data.editToken = editToken;
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
            isStaging: true,
            updatedBy: socket.data.stagingEmail
          });
        } else {
          // Live: broadcast to live room
          socket.to(`site:${siteId}`).emit('content-update', {
            elementId,
            content: sanitizedContent,
            language,
            variant
          });
        }

        // Notify dashboard users
        socket.to(`dashboard:${siteId}`).emit('content-updated', {
          elementId,
          content: sanitizedContent,
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
    onMessage('join-dashboard', (data) => {
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

  return { app, io, httpServer, listen, close };
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
  const server = createRealtimeServer({ port, supabase, rateLimitStore });

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
