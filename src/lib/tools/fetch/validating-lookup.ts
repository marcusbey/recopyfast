/**
 * A `lookup` for `http.request` that refuses to hand Node an address it has
 * not validated — the fix for the DNS-rebinding window the webhook guard
 * documents and leaves open (`webhook-url-safety.ts`, "WHAT IT DOES NOT DO").
 *
 * WHY A LOOKUP, NOT A CHECK BEFORE THE FETCH. A check that resolves a hostname
 * and then calls `fetch(url)` resolves twice: the attacker's DNS answers a
 * public address to the check and 169.254.169.254 to the fetch. Here the
 * resolution IS the connection's resolution: Node connects to exactly the
 * addresses this function returns, so the address validated is the address
 * dialled. Every hop of every scan calls it again (no caching), so a later hop
 * that rebinds is refused on its own answer.
 *
 * EVERY ADDRESS, NOT THE FIRST. A hostname with one public and one private
 * record is refused outright: with `autoSelectFamily` (Node 24's default) Node
 * may try any of them, and which one wins is not ours to guess.
 *
 * BOTH CALLBACK SHAPES. Node calls `lookup(host, { all: true }, cb)` when
 * `autoSelectFamily` is on (verified on 24.14) and the single-address form
 * otherwise; answering only one shape would crash the other path.
 *
 * WHAT IT CANNOT SEE. Node never calls `lookup` for an IP-literal host, so the
 * fetcher classifies literals itself before any socket opens (`safe-fetch.ts`).
 */

import { promises as dnsPromises } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import { classifyAddress } from "@/lib/security/public-address";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Answers every address a hostname resolves to. Injected by the tests. */
export type Resolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

/** True when a connection to this address is allowed. Injected by the tests. */
export type AddressRule = (address: string) => boolean;

/** Production rule: globally routable unicast only (`public-address.ts`). */
export const PUBLIC_ADDRESS_RULE: AddressRule = (address) =>
  classifyAddress(address) === null;

/** Production resolver: the OS resolver, every record, in its own order. */
export const SYSTEM_RESOLVER: Resolver = async (hostname) => {
  const answers = await dnsPromises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
};

/** A hostname resolved to at least one address the rule refuses. */
export class BlockedAddressError extends Error {
  readonly code = "ERR_RCF_BLOCKED_ADDRESS";
  constructor() {
    // Deliberately names no address: this error's message can reach a log
    // line, and the route never echoes what our resolver answered.
    super("Refused: the host resolves to a non-public address");
    this.name = "BlockedAddressError";
  }
}

/** The hostname did not resolve, or resolved to nothing. */
export class LookupFailedError extends Error {
  readonly code = "ERR_RCF_DNS";
  constructor() {
    super("The host could not be resolved");
    this.name = "LookupFailedError";
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type ValidatingLookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

export function createValidatingLookup(
  isAllowedAddress: AddressRule = PUBLIC_ADDRESS_RULE,
  resolver: Resolver = SYSTEM_RESOLVER,
): ValidatingLookup {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (answers) => {
        if (answers.length === 0) {
          callback(new LookupFailedError(), "", 0);
          return;
        }
        if (answers.some((answer) => !isAllowedAddress(answer.address))) {
          callback(new BlockedAddressError(), "", 0);
          return;
        }

        const family = typeof options.family === "number" ? options.family : 0;
        const usable =
          family === 4 || family === 6
            ? answers.filter((answer) => answer.family === family)
            : answers;
        if (usable.length === 0) {
          callback(new LookupFailedError(), "", 0);
          return;
        }

        if (options.all) {
          callback(
            null,
            usable.map((answer) => ({
              address: answer.address,
              family: answer.family,
            })),
          );
          return;
        }
        callback(null, usable[0].address, usable[0].family);
      },
      () => callback(new LookupFailedError(), "", 0),
    );
  };
}
