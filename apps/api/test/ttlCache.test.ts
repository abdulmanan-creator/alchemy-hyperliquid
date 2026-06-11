/**
 * TtlCache + cachedAsync unit tests — the primitives behind replay
 * protection, idempotency, and read caching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TtlCache, cachedAsync } from "../src/helpers/ttlCache.js";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns values before TTL and drops them after", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set("k", 1);
    expect(cache.get("k")).toBe(1);
    vi.advanceTimersByTime(999);
    expect(cache.get("k")).toBe(1);
    vi.advanceTimersByTime(2);
    expect(cache.get("k")).toBeUndefined();
  });

  it("addIfAbsent: true on first sighting, false while live, true after expiry", () => {
    const cache = new TtlCache<true>({ ttlMs: 1000 });
    expect(cache.addIfAbsent("sig", true)).toBe(true);
    expect(cache.addIfAbsent("sig", true)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(cache.addIfAbsent("sig", true)).toBe(true);
  });

  it("evicts oldest entries at capacity instead of growing unbounded", () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });
});

describe("cachedAsync", () => {
  it("coalesces concurrent callers onto one in-flight producer", async () => {
    const cache = new TtlCache<Promise<string>>({ ttlMs: 60_000 });
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return "value";
    };
    const [a, b] = await Promise.all([
      cachedAsync(cache, "k", producer),
      cachedAsync(cache, "k", producer),
    ]);
    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(calls).toBe(1);
  });

  it("evicts rejected promises so the next call retries", async () => {
    const cache = new TtlCache<Promise<string>>({ ttlMs: 60_000 });
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "recovered";
    };
    await expect(cachedAsync(cache, "k", flaky)).rejects.toThrow("boom");
    await expect(cachedAsync(cache, "k", flaky)).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });
});
