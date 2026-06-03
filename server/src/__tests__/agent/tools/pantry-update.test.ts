import { describe, it, expect, vi } from "vitest";

vi.mock("../../../services/pantryBatchService.js", () => ({
  createBatch: vi.fn(),
  updateBatch: vi.fn().mockResolvedValue({ id: 12, quantity: 3, unit: "cup" }),
  softDeleteBatch: vi.fn(),
}));
vi.mock("../../../lib/prisma.js", () => ({ prisma: { pantryBatch: { findMany: vi.fn(), delete: vi.fn() } } }));

describe("update_pantry_batch", () => {
  it("calls pantryBatchService.updateBatch with the partial input", async () => {
    const { pantryTools } = await import("../../../agent/tools/pantry.js");
    const tool = pantryTools.find((t) => t.name === "update_pantry_batch")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ batchId: 12, quantity: 3, unit: "cup" }, { pageContext: {} });
    expect(out).toMatchObject({ batch: { id: 12, quantity: 3 } });
    const { updateBatch } = await import("../../../services/pantryBatchService.js");
    expect(updateBatch).toHaveBeenCalledWith(12, { quantity: 3, unit: "cup" });
  });
});
