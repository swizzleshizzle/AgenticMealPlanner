import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function purgeConsumedBatches(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.pantryBatch.deleteMany({
    where: { consumedAt: { lt: cutoff } },
  });
  return result.count;
}
