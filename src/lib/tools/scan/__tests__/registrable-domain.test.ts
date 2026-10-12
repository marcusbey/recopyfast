/**
 * @jest-environment node
 */

/**
 * s96 review, minor 3: the per-target hourly cap is keyed on the registrable
 * domain (eTLD+1, from the Public Suffix List via `tldts`), so a victim's
 * subdomains share one bucket. Private suffixes count as public ones: two
 * Shopify stores, or two GitHub Pages sites, belong to different owners and
 * must not share a bucket.
 */

import { registrableDomain } from "../registrable-domain";

describe("registrableDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["www.example.com", "example.com"],
    ["a.b.c.example.com", "example.com"],
    ["Example.COM.", "example.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["shop.example.com.au", "example.com.au"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
    ["www.bakery.test", "bakery.test"],
  ])("%s → %s", (hostname, expected) => {
    expect(registrableDomain(hostname)).toBe(expected);
  });

  it.each([
    ["shop-one.myshopify.com", "shop-one.myshopify.com"],
    ["someone.github.io", "someone.github.io"],
    ["preview.someone.vercel.app", "someone.vercel.app"],
  ])("keeps the owner of a private suffix: %s → %s", (hostname, expected) => {
    expect(registrableDomain(hostname)).toBe(expected);
  });

  /**
   * s96 review round 2, minor 2: `tldts` validates host names by default and
   * answered null for these, so the key fell back to the full host — a fresh
   * bucket per invented subdomain. Validation is off; the URL normaliser
   * refuses such hosts on its own.
   */
  it.each([
    "-a.victim.com",
    "a-.victim.com",
    "a!b.victim.com",
    "a_b.victim.com",
  ])("keys the non-LDH host %s on victim.com", (hostname) => {
    expect(registrableDomain(hostname)).toBe("victim.com");
  });

  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["[2606:4700:4700::1111]", "2606:4700:4700::1111"],
    ["localhost", "localhost"],
    ["co.uk", "co.uk"],
  ])("falls back to the host itself for %s", (hostname, expected) => {
    expect(registrableDomain(hostname)).toBe(expected);
  });
});
