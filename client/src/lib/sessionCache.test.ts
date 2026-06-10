// client/src/lib/sessionCache.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { readCache, writeCache, clearCache, type StorageLike } from "./sessionCache";

function fakeStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe("sessionCache", () => {
  let s: StorageLike;
  beforeEach(() => { s = fakeStorage(); });

  it("round-trips a value through write/read", () => {
    writeCache(s, "k", { a: 1, b: ["x"] });
    expect(readCache(s, "k")).toEqual({ a: 1, b: ["x"] });
  });

  it("returns null for a missing key", () => {
    expect(readCache(s, "nope")).toBeNull();
  });

  it("returns null and does not throw for a null storage", () => {
    expect(readCache(null, "k")).toBeNull();
    expect(() => writeCache(null, "k", 1)).not.toThrow();
    expect(() => clearCache(null, "k")).not.toThrow();
  });

  it("returns null for corrupt JSON instead of throwing", () => {
    s.setItem("amp:bad", "{not json");
    expect(readCache(s, "bad")).toBeNull();
  });

  it("clearCache removes a key", () => {
    writeCache(s, "k", 1);
    clearCache(s, "k");
    expect(readCache(s, "k")).toBeNull();
  });

  it("namespaces keys under the amp: prefix", () => {
    writeCache(s, "k", 1);
    expect(s.getItem("amp:k")).toBe("1");
  });
});
