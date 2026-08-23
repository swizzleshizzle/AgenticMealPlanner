import { describe, it, expect } from "vitest";
import { assertSdkResultUsable, SdkNotLoggedInError } from "../claude/sdkClient.js";

describe("assertSdkResultUsable", () => {
  it("turns the SDK's not-logged-in text into a descriptive error", () => {
    // Observed 2026-08-23: expired credentials make the SDK return this string
    // as a normal result; parsers then failed with a misleading
    // "no parseable JSON" error.
    expect(() => assertSdkResultUsable("Not logged in · Please run /login")).toThrow(
      SdkNotLoggedInError,
    );
    expect(() => assertSdkResultUsable("Not logged in · Please run /login")).toThrow(
      /claude login/i,
    );
  });

  it("passes normal results through untouched", () => {
    expect(assertSdkResultUsable('{"ok":true}')).toBe('{"ok":true}');
    expect(assertSdkResultUsable("Some recipe text mentioning login pages")).toBe(
      "Some recipe text mentioning login pages",
    );
  });
});
