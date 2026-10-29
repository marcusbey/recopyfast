const { addressBucket } = require('./rate-limit');

const DEFAULT_MAX_CONCURRENT_TRANSPORTS_PER_ADDRESS = 20;
const DEFAULT_RESERVATION_TIMEOUT_MS = 5000;

function resolveRequestAddress(request, { trustFlyClientIp = false } = {}) {
  if (trustFlyClientIp) {
    const reported = request.headers && request.headers['fly-client-ip'];
    if (typeof reported === 'string' && reported.trim() !== '') {
      return addressBucket(reported);
    }
  }
  return addressBucket(request.socket && request.socket.remoteAddress);
}

/**
 * Reserve capacity before Engine.IO creates a client.
 *
 * TOMBSTONE — s128 / audit M6. Counting `io.engine.clientsCount` inside the
 * Socket.IO connection handler is too late: parallel upgrades all pass before
 * any of them becomes a client. Reservations therefore include upgrades still
 * in flight, then transfer to Engine.IO's close lifecycle. Every cleanup path
 * is idempotent because an aborted upgrade can report through several events.
 */
function createConnectionLimiter(options = {}) {
  const maxConcurrentTransportsPerAddress =
    options.maxConcurrentTransportsPerAddress ??
    DEFAULT_MAX_CONCURRENT_TRANSPORTS_PER_ADDRESS;
  const reservationTimeoutMs =
    options.reservationTimeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS;
  const trustFlyClientIp = Boolean(options.trustFlyClientIp);
  const counts = new Map();
  const reservations = new Set();
  const byRequest = new WeakMap();

  function reserve(request) {
    const address = resolveRequestAddress(request, { trustFlyClientIp });
    const current = counts.get(address) ?? 0;
    if (current >= maxConcurrentTransportsPerAddress) {
      return { allowed: false, address };
    }

    counts.set(address, current + 1);
    let released = false;
    let timer;
    const requestSocket = request.socket;

    const reservation = {
      address,
      release() {
        if (released) return;
        released = true;
        clearTimeout(timer);
        request.removeListener('aborted', reservation.release);
        request.removeListener('error', reservation.release);
        if (requestSocket)
          requestSocket.removeListener('close', reservation.release);
        reservations.delete(reservation);
        byRequest.delete(request);
        const next = (counts.get(address) ?? 1) - 1;
        if (next <= 0) counts.delete(address);
        else counts.set(address, next);
      },
      transfer(engineSocket) {
        if (released) return false;
        clearTimeout(timer);
        request.removeListener('aborted', reservation.release);
        request.removeListener('error', reservation.release);
        if (requestSocket)
          requestSocket.removeListener('close', reservation.release);
        engineSocket.once('close', reservation.release);
        return true;
      },
    };

    request.once('aborted', reservation.release);
    request.once('error', reservation.release);
    if (requestSocket) requestSocket.once('close', reservation.release);
    timer = setTimeout(reservation.release, reservationTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    reservations.add(reservation);
    byRequest.set(request, reservation);
    return { allowed: true, address, release: reservation.release };
  }

  return {
    reserve,
    transfer(request, engineSocket) {
      const reservation = byRequest.get(request);
      return reservation ? reservation.transfer(engineSocket) : false;
    },
    releaseAll() {
      for (const reservation of [...reservations]) reservation.release();
    },
    get size() {
      return reservations.size;
    },
    count(address) {
      return counts.get(addressBucket(address)) ?? 0;
    },
  };
}

module.exports = {
  DEFAULT_MAX_CONCURRENT_TRANSPORTS_PER_ADDRESS,
  DEFAULT_RESERVATION_TIMEOUT_MS,
  createConnectionLimiter,
  resolveRequestAddress,
};
