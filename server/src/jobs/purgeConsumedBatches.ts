import { prisma } from "../lib/prisma.js";

// NOTE: this hard-deletes consumed batches including their costAtPurchase /
// purchaseDate. If spend-history reporting is ever needed, aggregate before
// deleting or lengthen the retention window (see code review, data layer #4).
export async function purgeConsumedBatches(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.pantryBatch.deleteMany({
    where: { consumedAt: { lt: cutoff } },
  });
  return result.count;
}
