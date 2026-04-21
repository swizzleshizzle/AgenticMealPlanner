import { describe, it, expect } from "vitest";
import { passesSizeGate, parseImagesList } from "../services/pdfExtraction.js";

describe("pdfExtraction.passesSizeGate", () => {
  it("accepts a 400x300, 20KB image", () => {
    expect(passesSizeGate({ width: 400, height: 300, bytes: 20_480 })).toBe(true);
  });
  it("rejects under-minimum width", () => {
    expect(passesSizeGate({ width: 399, height: 300, bytes: 20_480 })).toBe(false);
  });
  it("rejects under-minimum bytes", () => {
    expect(passesSizeGate({ width: 800, height: 600, bytes: 10_000 })).toBe(false);
  });
  it("rejects absurd aspect ratio (> 4:1 or < 1:4)", () => {
    expect(passesSizeGate({ width: 2000, height: 300, bytes: 60_000 })).toBe(false);
    expect(passesSizeGate({ width: 300, height: 2000, bytes: 60_000 })).toBe(false);
  });
});

describe("pdfExtraction.parseImagesList", () => {
  it("parses pdfimages -list output and returns rows sorted by area descending", () => {
    const raw = [
      "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
      "--------------------------------------------------------------------------------------------",
      "   1     0 image     100   100  rgb     3   8  jpeg   no        12  0    96    96  3.5K 12%",
      "   1     1 image     800   600  rgb     3   8  jpeg   no        13  0    96    96  55K  12%",
      "   1     2 image     400   300  rgb     3   8  jpeg   no        14  0    96    96  22K  12%",
    ].join("\n");
    const rows = parseImagesList(raw);
    expect(rows[0].width).toBe(800);
    expect(rows[0].height).toBe(600);
    expect(rows[1].width).toBe(400);
    expect(rows[2].width).toBe(100);
  });

  it("returns empty array on empty output", () => {
    expect(parseImagesList("")).toEqual([]);
  });
});
