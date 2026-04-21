import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stashImportPdf, popImportPdf, clearExpired } from "../services/importSessions.js";

describe("importSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stash returns a session id and pop returns the path", () => {
    const id = stashImportPdf("/tmp/abc.pdf");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(popImportPdf(id)).toBe("/tmp/abc.pdf");
  });

  it("pop returns null for unknown id", () => {
    expect(popImportPdf("does-not-exist")).toBeNull();
  });

  it("pop is single-use", () => {
    const id = stashImportPdf("/tmp/x.pdf");
    expect(popImportPdf(id)).toBe("/tmp/x.pdf");
    expect(popImportPdf(id)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const id = stashImportPdf("/tmp/y.pdf");
    vi.advanceTimersByTime(16 * 60 * 1000);
    clearExpired();
    expect(popImportPdf(id)).toBeNull();
  });
});
