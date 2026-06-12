import { describe, it, expect } from "vitest";
import {
  buildFirstPassPrompt,
  buildRescuePrompt,
  ensureParsedItems,
  EmptyParseError,
  extractJson,
  type ReceiptParseInput,
} from "../claude/receiptParser.js";
import type { ParsedReceiptPayload } from "../services/receiptParseSessions.js";

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

  it("with tile paths, lists every tile in order and instructs overlap dedupe", () => {
    const input: ReceiptParseInput = { kind: "photo", path: "/tmp/order.png" };
    const tiles = ["/tmp/order.tile0.png", "/tmp/order.tile1.png", "/tmp/order.tile2.png"];
    const prompt = buildFirstPassPrompt(input, tiles);
    for (const t of tiles) expect(prompt).toContain(t);
    // Tiles listed top-to-bottom, original path not referenced.
    expect(prompt.indexOf(tiles[0])).toBeLessThan(prompt.indexOf(tiles[1]));
    expect(prompt.indexOf(tiles[1])).toBeLessThan(prompt.indexOf(tiles[2]));
    expect(prompt).not.toContain("/tmp/order.png\n");
    expect(prompt).toMatch(/overlap/i);
    expect(prompt).toMatch(/duplicate|dedupe|once/i);
    expect(prompt).toMatch(/JSON/);
  });
});

describe("ensureParsedItems", () => {
  const emptyPayload = { store: "unknown", tripDate: "2026-06-11", total: 0, items: [] } as unknown as ParsedReceiptPayload;
  const fullPayload = {
    store: "Walmart",
    tripDate: "2026-06-09",
    total: 42,
    items: [{ rawName: "GV RICE 5LB", parsedName: "rice", quantity: 5, unit: "lb", kind: "food" }],
  } as unknown as ParsedReceiptPayload;

  it("throws EmptyParseError when a photo parse yields zero items", () => {
    expect(() => ensureParsedItems(emptyPayload, "photo")).toThrow(EmptyParseError);
  });

  it("throws EmptyParseError when a pdf parse yields zero items", () => {
    expect(() => ensureParsedItems(emptyPayload, "pdf")).toThrow(EmptyParseError);
  });

  it("does not throw for a text parse with zero items", () => {
    expect(() => ensureParsedItems(emptyPayload, "text")).not.toThrow();
  });

  it("does not throw when items are present", () => {
    expect(() => ensureParsedItems(fullPayload, "photo")).not.toThrow();
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
