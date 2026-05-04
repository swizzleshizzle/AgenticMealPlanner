import { describe, it, expect } from "vitest";
import {
  buildFirstPassPrompt,
  buildRescuePrompt,
  extractJson,
  type ReceiptParseInput,
} from "../claude/receiptParser.js";

describe("buildFirstPassPrompt", () => {
  it("photo input includes the file path and instructs use of Read", () => {
    const input: ReceiptParseInput = { kind: "photo", path: "/tmp/aldi.jpg" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("/tmp/aldi.jpg");
    expect(prompt).toContain("photo");
    expect(prompt).toMatch(/JSON/);
    expect(prompt).toMatch(/store/);
    expect(prompt).toMatch(/tripDate/);
    expect(prompt).toMatch(/items/);
  });

  it("text input embeds the raw text and labels it as a digital order", () => {
    const input: ReceiptParseInput = { kind: "text", text: "GV Whole Milk 1G $3.97" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("GV Whole Milk 1G $3.97");
    expect(prompt).toMatch(/digital/i);
  });

  it("pdf input includes the file path", () => {
    const input: ReceiptParseInput = { kind: "pdf", path: "/tmp/walmart.pdf" };
    const prompt = buildFirstPassPrompt(input);
    expect(prompt).toContain("/tmp/walmart.pdf");
  });
});

describe("buildRescuePrompt", () => {
  it("includes only the weak items and the existing ingredient list", () => {
    const weakItems = [
      { rawName: "ORG SPNCH 5OZ", parsedName: "spinach 5oz" },
      { rawName: "BNN .35 LB", parsedName: "bananas" },
    ];
    const ingredients = [
      { id: 1, name: "spinach" },
      { id: 2, name: "banana" },
      { id: 3, name: "whole milk" },
    ];
    const prompt = buildRescuePrompt(weakItems, ingredients);
    expect(prompt).toContain("ORG SPNCH 5OZ");
    expect(prompt).toContain("BNN .35 LB");
    expect(prompt).toContain("spinach");
    expect(prompt).toContain("banana");
    expect(prompt).toContain("whole milk");
    expect(prompt).toMatch(/JSON/);
  });
});

describe("extractJson", () => {
  it("extracts from a fenced code block with json hint", () => {
    const raw = "Some preamble.\n```json\n{\"store\": \"Aldi\"}\n```\n";
    expect(extractJson(raw)).toBe('{"store": "Aldi"}');
  });

  it("extracts from a fenced code block without language hint", () => {
    const raw = "```\n{\"a\": 1}\n```";
    expect(extractJson(raw)).toBe('{"a": 1}');
  });

  it("falls back to greedy brace match", () => {
    const raw = "Here is the data: {\"store\": \"Walmart\", \"items\": []}";
    expect(extractJson(raw)).toBe('{"store": "Walmart", "items": []}');
  });

  it("returns null when there is no JSON-shaped text", () => {
    expect(extractJson("nothing to parse")).toBeNull();
  });
});
