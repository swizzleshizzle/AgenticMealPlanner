import { describe, it, expect } from "vitest";
import { normalizeTag, normalizeTags, planTagMerges } from "../lib/tags.js";

describe("normalizeTag", () => {
  it("lowercases, trims, and hyphenates separators", () => {
    expect(normalizeTag("  Asian Inspired ")).toBe("asian-inspired");
    expect(normalizeTag("Rice_Bowl")).toBe("rice-bowl");
    expect(normalizeTag("QUICK")).toBe("quick");
  });

  it("collapses repeated separators and strips dangling hyphens", () => {
    expect(normalizeTag("air  -  fryer")).toBe("air-fryer");
    expect(normalizeTag("-bbq-")).toBe("bbq");
  });
});

describe("normalizeTags", () => {
  it("normalizes, drops empties, and dedupes preserving order", () => {
    expect(normalizeTags(["Beef", "beef", " ", "BBQ", "bbq "])).toEqual(["beef", "bbq"]);
  });
});

describe("planTagMerges", () => {
  it("merges case/separator variants into the normalized form", () => {
    const { merges } = planTagMerges([["Asian", "rice bowl"], ["asian", "rice-bowl"]]);
    expect(merges["Asian"]).toBe("asian");
    expect(merges["rice bowl"]).toBe("rice-bowl");
  });

  it("merges plurals into an existing singular", () => {
    const { merges } = planTagMerges([["burger"], ["burgers"], ["burgers"]]);
    expect(merges["burgers"]).toBe("burger");
  });

  it("does not singularize when no singular form exists", () => {
    const { merges } = planTagMerges([["dumplings"], ["noodles"]]);
    expect(merges).not.toHaveProperty("dumplings");
    expect(merges).not.toHaveProperty("noodles");
  });

  it("merges '-inspired' variants into an existing base cuisine", () => {
    const { merges } = planTagMerges([["asian"], ["asian-inspired"]]);
    expect(merges["asian-inspired"]).toBe("asian");
  });

  it("resolves chains (plural of an -inspired variant lands on the base)", () => {
    const { merges } = planTagMerges([["taco"], ["Tacos"]]);
    expect(merges["Tacos"]).toBe("taco");
  });

  it("reports vocabulary frequencies", () => {
    const { counts } = planTagMerges([["beef", "bbq"], ["beef"]]);
    expect(counts["beef"]).toBe(2);
    expect(counts["bbq"]).toBe(1);
  });
});
