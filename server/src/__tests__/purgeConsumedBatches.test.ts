import { describe, it, expect, vi } from "vitest";

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      pantryBatch: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    })),
  };
});

import { purgeConsumedBatches } from "../jobs/purgeConsumedBatches.js";

describe("purgeConsumedBatches", () => {
  it("uses a 30-day cutoff from `now`", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const count = await purgeConsumedBatches(now);
    expect(count).toBe(3);
  });
});
