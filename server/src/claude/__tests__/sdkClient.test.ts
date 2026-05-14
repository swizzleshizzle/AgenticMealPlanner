import { describe, it, expect } from "vitest";
import { stripFences } from "../sdkClient.js";

describe("stripFences", () => {
  it("returns plain text unchanged", () => {
    expect(stripFences("hello world")).toBe("hello world");
  });

  it("strips ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips bare ``` fences", () => {
    expect(stripFences("```\nfoo\n```")).toBe("foo");
  });

  it("trims surrounding whitespace", () => {
    expect(stripFences("  hello  ")).toBe("hello");
  });

  it("leaves embedded backticks alone", () => {
    expect(stripFences("use `npm test`")).toBe("use `npm test`");
  });
});
