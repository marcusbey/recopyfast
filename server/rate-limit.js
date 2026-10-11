/**
 * Rate limiting for the realtime service.
 *
 * ADR 002 rule 4: a service-role path carries a fail-closed rate limiter keyed
 * on the site (`onStoreFailure: "deny"`). This process holds
 * SUPABASE_SERVICE_ROLE_KEY and had no limiter of any kind. Every argument in
 * that rule applies verbatim here — the credential that opens this socket is
 * `data-site-token`, published in the customer's own page markup, so it is
 * readable with View Source and copyable by anyone who visits their site.
 *
 * "Deny" is the whole point, and it is the setting that looks wrong until you
 * ask what the alternative means: allowing on store failure turns "Redis is
 * unreachable" into "the limit is off", and those two states are
 * indistinguishable from the outside — including to whoever is holding the
 * copied token.
 */

const { isIP } = require('node:net');

/** ADR 002 rule 4. Not a knob: there is no configuration in which this is "allow". */
const ON_STORE_FAILURE = 'deny';

const DEFAULT_RATE_LIMIT = {
  windowMs: 60 * 1000,
  /**
   * Handshakes per client address per window, counted BEFORE anything is
   * verified (s79, s69 L14). This is the limiter AGENTS.md asks for in front
   * of authorization — the `sites` lookup is a database round trip — and it is
   * keyed on the caller, so a flood exhausts the flooder's own bucket and
   * nobody else's. 60 is a reconnect storm from one office with room to spare.
   * The address is the client's as Fly's proxy reports it (index.js
   * `resolveClientAddress`); keyed on the TCP peer behind the proxy it would
   * be one bucket for every client in the world.
   */
  maxHandshakesPerAddress: 60,
  /**
   * Connections per site per window, counted only once a handshake's token and
   * origin VERIFIED (s79). Every visitor to a page whose snippet carries
   * `data-ws-url` opens one, even though today's fan-out targets staging and
   * dashboard rooms; staging sockets additionally require an editor grant.
   * 120 is the existing per-site ceiling and still bounds a copied token.
   */
  maxConnectionsPerSite: 120,
  /**
   * Connections per site per peer address. Tighter than the per-site cap and
   * deliberately secondary to it: behind a proxy every client shares one peer
   * address, so this bucket can collapse — the per-site cap is the one that
   * cannot be evaded and the one ADR 002 actually asks for.
   */
  maxConnectionsPerAddress: 40,
  /**
   * Messages per socket per window. The emit follows a completed HTTP PUT
   * (`persistContentUpdate`, recopyfast.src.js:2625), so it is one per save,
   * not one per keystroke.
   */
  maxMessagesPerSocket: 600,
};

/** IPv6 hextets that name one subscriber: the routing prefix of a /64. */
const IPV6_SUBSCRIBER_HEXTETS = 4;
const EMBEDDED_IPV4_TAIL = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The eight hextets of a valid IPv6 address, zone id dropped, normalised. */
function ipv6Hextets(address) {
  let text = address.split('%')[0];
  const tail = EMBEDDED_IPV4_TAIL.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const restParts = rest ? rest.split(':') : [];
  const zeros =
    rest === undefined ? [] : Array(8 - headParts.length - restParts.length).fill('0');
  return [...headParts, ...zeros, ...restParts].map((part) =>
    parseInt(part, 16).toString(16)
  );
}

/** An IPv4 address written through IPv6's mapped-address form, if present. */
function mappedIpv4(hextets) {
  const isMapped =
    hextets.slice(0, 5).every((part) => part === '0') && hextets[5] === 'ffff';
  if (!isMapped) return null;

  const high = parseInt(hextets[6], 16);
  const low = parseInt(hextets[7], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

/**
 * The identity a per-address bucket counts (s79 review F7).
 *
 * An IPv4 client is its address. An IPv6 client is its /64: a subscriber line
 * is handed a whole /64, so keyed on the full address one client rotating
 * through its own block got a fresh bucket — and a fresh `sites` read — on
 * every handshake. An IPv4-mapped address (`::ffff:203.0.113.7`, how Node
 * reports an IPv4 peer on a dual-stack listener) is the IPv4 client it maps:
 * read as IPv6, every IPv4 client in the world would share one /64 bucket.
 * Anything absent or malformed shares the `unknown` bucket. Keeping the raw
 * string would let a malformed trusted-proxy header invent an unlimited number
 * of buckets, which is the same bypass this normalisation closes for IPv6.
 */
function addressBucket(address) {
  if (typeof address !== 'string' || address.trim() === '') return 'unknown';
  const trimmed = address.trim();
  const family = isIP(trimmed);
  if (family === 4) return trimmed;
  if (family !== 6) return 'unknown';

  try {
    const hextets = ipv6Hextets(trimmed);
    const mapped = mappedIpv4(hextets);
    if (mapped) return mapped;
    const prefix = hextets.slice(0, IPV6_SUBSCRIBER_HEXTETS);
    return `${prefix.join(':')}::/64`;
  } catch (_error) {
    // `isIP` and this parser are deliberately independent guards. If a future
    // Node version accepts an address shape this normaliser cannot expand, it
    // fails closed into one bounded bucket instead of throwing in a handshake.
    return 'unknown';
  }
}

/** Max time to wait for the TCP handshake before giving up on Redis. */
const REDIS_CONNECT_TIMEOUT_MS = 2000;

/** Max time to wait for a single rate-limit command round trip. */
const REDIS_COMMAND_TIMEOUT_MS = 1500;

async function withTimeout(operation, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A counter store over node-redis 5 — the same client
 * `src/lib/security/rate-limiter.ts` uses, so the two limiters share a Redis and
 * a key convention rather than each inventing one.
 *
 * `increment` returns the count for the key within its window. It THROWS when
 * Redis is unreachable; it never silently reports 1. The deny decision belongs
 * to the limiter, not to the store.
 */
function createRedisRateLimitStore(options = {}) {
  const url = options.url || process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is required to build the Redis rate-limit store');
  }

  const { createClient } = require('redis');
  let client = null;
  let connecting = null;

  function ensureClient() {
    if (client) return client;

    client = createClient({
      url,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        // One retry, then surface the failure so the limiter can deny. Retrying
        // forever would hold every handshake open instead of refusing it.
        reconnectStrategy: (retries) =>
          retries > 1 ? new Error('Redis unreachable') : 200,
      },
    });

    // node-redis emits 'error' for connection AND command failures. An
    // unhandled 'error' on an EventEmitter takes the process down, so this
    // listener is mandatory even though the rejected promise is what we act on.
    client.on('error', (error) => {
      console.error('[rate-limit] Redis client error:', error.message);
    });

    return client;
  }

  function resetClient() {
    const previous = client;
    client = null;
    connecting = null;
    if (!previous) return;
    try {
      previous.destroy();
    } catch (error) {
      // The socket is already gone; nothing left to clean up.
    }
  }

  async function connect() {
    const active = ensureClient();
    if (active.isOpen) return active;

    if (!connecting) {
      connecting = withTimeout(
        active.connect().then(() => undefined),
        REDIS_CONNECT_TIMEOUT_MS,
        'Redis connect'
      ).finally(() => {
        connecting = null;
      });
    }

    try {
      await connecting;
    } catch (error) {
      resetClient();
      throw error;
    }

    return active;
  }

  return {
    async increment(key, windowMs) {
      const active = await connect();
      const pipeline = active.multi();
      pipeline.incr(key);
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      let results;
      try {
        results = await withTimeout(
          pipeline.exec(),
          REDIS_COMMAND_TIMEOUT_MS,
          'Redis rate-limit pipeline'
        );
      } catch (error) {
        // A timed-out or failed command usually means the socket is unusable.
        resetClient();
        throw error;
      }

      if (!results || results.length < 2) {
        throw new Error('Redis pipeline execution failed');
      }

      const count = Number(results[0]);
      // A non-numeric INCR reply means the key holds something else entirely.
      // Treating NaN as a count would make every comparison false-y, which here
      // means "allowed" — a silent removal of the limit.
      if (!Number.isFinite(count)) {
        throw new Error('Redis INCR returned a non-numeric reply');
      }

      return count;
    },

    async close() {
      resetClient();
    },
  };
}

/**
 * In-process counters, for development and for tests.
 *
 * Not a fallback: nothing selects this when Redis fails. A single instance is
 * the only shape in which it is correct, which is exactly the shape `s07b` has
 * to decide on explicitly.
 */
function createMemoryRateLimitStore() {
  const counters = new Map();

  return {
    async increment(key) {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      // Keys carry their window index, so an old key is dead the moment the
      // window rolls. Sweeping them keeps a long-lived process from growing a
      // map entry per site per minute forever.
      if (counters.size > 10000) {
        counters.clear();
      }
      return next;
    },
    async close() {
      counters.clear();
    },
  };
}

/**
 * @param {object} options
 * @param {{ increment: (key: string, windowMs: number) => Promise<number> }} options.store
 */
function createRateLimiter(options = {}) {
  const store = options.store;
  if (!store) {
    throw new Error('createRateLimiter requires a store');
  }

  const config = { ...DEFAULT_RATE_LIMIT, ...(options.limits || {}) };

  async function consume(namespace, identifier, max) {
    const window = Math.floor(Date.now() / config.windowMs);
    const key = `rcf:ws:${namespace}:${identifier}:${window}`;

    let count;
    try {
      count = await store.increment(key, config.windowMs);
    } catch (error) {
      // onStoreFailure: "deny". See the file header.
      console.error(
        `[rate-limit] store unavailable, denying (${ON_STORE_FAILURE}):`,
        error.message
      );
      return { allowed: false, reason: 'store-unavailable' };
    }

    if (!Number.isFinite(count)) {
      return { allowed: false, reason: 'store-unavailable' };
    }

    return { allowed: count <= max, reason: 'over-limit' };
  }

  return {
    onStoreFailure: ON_STORE_FAILURE,
    config,

    /**
     * The pre-authorization bucket: one per client address, across all sites.
     * Called before the `sites` lookup. See `maxHandshakesPerAddress`.
     */
    async checkHandshake({ address }) {
      return consume(
        'conn-pre',
        addressBucket(address),
        config.maxHandshakesPerAddress
      );
    },

    /**
     * Two buckets, both of which must pass. The per-site one is the ADR's
     * requirement and cannot be evaded by a token holder; the per-address one
     * is finer. Called only for a handshake that verified (s79): spent before
     * verification, the per-site bucket was the cheapest lock-out on a named
     * customer — 121 bare handshakes and every editor was refused.
     */
    async checkConnection({ siteId, address }) {
      const perSite = await consume('conn-site', siteId, config.maxConnectionsPerSite);
      if (!perSite.allowed) return perSite;

      return consume(
        'conn-addr',
        `${siteId}:${addressBucket(address)}`,
        config.maxConnectionsPerAddress
      );
    },

    async checkMessage({ socketId }) {
      return consume('msg', socketId, config.maxMessagesPerSocket);
    },
  };
}

module.exports = {
  DEFAULT_RATE_LIMIT,
  addressBucket,
  ON_STORE_FAILURE,
  createMemoryRateLimitStore,
  createRateLimiter,
  createRedisRateLimitStore,
};
