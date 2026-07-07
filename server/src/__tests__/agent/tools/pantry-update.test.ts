import { describe, it, expect, vi } from "vitest";

vi.mock("../../../services/pantryBatchService.js", () => ({
  createBatch: vi.fn(),
  updateBatch: vi.fn().mockResolvedValue({ id: 12, quantity: 3, unit: "cup" }),
  softDeleteBatch: vi.fn(),
  hardDeleteBatch: vi.fn(),
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

describe("consume_pantry_batch", () => {
  it("calls softDeleteBatch and returns the batch with consumedAt set", async () => {
    const { softDeleteBatch } = await import("../../../services/pantryBatchService.js");
    (softDeleteBatch as any).mockResolvedValueOnce({ id: 12, consumedAt: new Date("2026-05-14") });
    const { pantryTools } = await import("../../../agent/tools/pantry.js");
    const tool = pantryTools.find((t) => t.name === "consume_pantry_batch")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ batchId: 12 }, { pageContext: {} });
    expect((out as any).batch.consumedAt).toBeDefined();
    expect(softDeleteBatch).toHaveBeenCalledWith(12);
  });
});

describe("delete_pantry_batch", () => {
  it("calls hardDeleteBatch with the id", async () => {
    const { hardDeleteBatch } = await import("../../../services/pantryBatchService.js");
    (hardDeleteBatch as any).mockResolvedValueOnce({ id: 12 });
    const { pantryTools } = await import("../../../agent/tools/pantry.js");
    const tool = pantryTools.find((t) => t.name === "delete_pantry_batch")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ batchId: 12, confirmed: true }, { pageContext: {} });
    expect(out).toEqual({ deletedId: 12 });
    expect(hardDeleteBatch).toHaveBeenCalledWith(12);
  });

  it("refuses to delete without confirmation", async () => {
    const { hardDeleteBatch } = await import("../../../services/pantryBatchService.js");
    (hardDeleteBatch as any).mockClear();
    const { pantryTools } = await import("../../../agent/tools/pantry.js");
    const tool = pantryTools.find((t) => t.name === "delete_pantry_batch")!;
    await expect(tool.handler({ batchId: 12 }, { pageContext: {} })).rejects.toThrow(/confirm/i);
    expect(hardDeleteBatch).not.toHaveBeenCalled();
  });
});
