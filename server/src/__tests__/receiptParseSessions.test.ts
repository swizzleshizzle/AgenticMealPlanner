import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  stashReceiptParse,
  popReceiptParse,
  peekReceiptParse,
  clearExpired,
} from "../services/receiptParseSessions.js";

const samplePayload = {
  store: "Aldi",
  tripDate: "2026-05-03",
  total: 84.32,
  items: [],
};

describe("receiptParseSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stash returns a session id and pop returns the payload + path", () => {
    const id = stashReceiptParse(samplePayload, "/tmp/aldi.jpg");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const popped = popReceiptParse(id);
    expect(popped?.payload).toEqual(samplePayload);
    expect(popped?.sourcePath).toBe("/tmp/aldi.jpg");
  });

  it("pasted text uses sourcePath = null and stashes rawText", () => {
    const id = stashReceiptParse(samplePayload, null, "GV WHL MILK 1G $3.97");
    const popped = popReceiptParse(id);
    expect(popped?.sourcePath).toBeNull();
    expect(popped?.rawText).toBe("GV WHL MILK 1G $3.97");
  });

  it("file uploads stash rawText = null by default", () => {
    const id = stashReceiptParse(samplePayload, "/tmp/aldi.jpg");
    expect(popReceiptParse(id)?.rawText).toBeNull();
  });

  it("peek returns the payload without consuming it", () => {
    const id = stashReceiptParse(samplePayload, null);
    expect(peekReceiptParse(id)?.payload).toEqual(samplePayload);
    expect(peekReceiptParse(id)?.payload).toEqual(samplePayload);
  });

  it("pop is single-use", () => {
    const id = stashReceiptParse(samplePayload, null);
    expect(popReceiptParse(id)).not.toBeNull();
    expect(popReceiptParse(id)).toBeNull();
  });

  it("pop returns null for unknown id", () => {
    expect(popReceiptParse("does-not-exist")).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const id = stashReceiptParse(samplePayload, null);
    vi.advanceTimersByTime(16 * 60 * 1000);
    clearExpired();
    expect(popReceiptParse(id)).toBeNull();
  });
});
